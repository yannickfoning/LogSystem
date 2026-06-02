import logger from '../config/logger.js';

const clients = new Set();
const ALERT_BUFFER_SIZE = 100; // FIX #8: Buffer pour les alertes récentes
const ALERT_TTL_MINUTES = 30; // A-02: TTL for buffer (don't replay alerts older than 30 min)
const alertBuffer = []; // Buffer circulaire pour Last-Event-ID
let lastAlertId = 0;

// A-04: Severity levels for filtering
const SEVERITY_ORDER = { low: 1, medium: 2, high: 3, critical: 4 };

function canReceiveScopedEvent(client, userId) {
  return !userId || client.userId === userId || client.role === 'admin';
}

function formatSse(event, data, id = null) {
  const idLine = id != null ? `id: ${id}\n` : '';
  return `${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function normalizeLogPayload(log) {
  return {
    event_type: 'log',
    id: log.id,
    timestamp: log.timestamp,
    log_level: log.log_level,
    message: log.message,
    source: log.source,
    service: log.service,
    user_id: log.user_id ?? null,
    created_at: log.created_at,
    job_id: log.job_id
  };
}

class AlertWorker {
  addClient(res, req) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const clientId = Date.now() + '-' + Math.random().toString(36).slice(2);
    // FIX #6: Stocker user_id et role pour scoper les alertes
    const userId = req.session?.user?.id || req.user?.id || null;
    const userRole = req.session?.user?.role || req.user?.role || null;
    // A-04: Parse severity filter from query params
    const minSeverityQuery = req.query.min_severity || 'low';
    const minSeverity = SEVERITY_ORDER[minSeverityQuery] || 1;
    const client = {
      id: clientId,
      res,
      req,
      userId,
      role: userRole,
      minSeverity,
      createdAt: Date.now(),
      lastActivity: Date.now()
    };

    res.write(`id: ${clientId}\nevent: connected\ndata: {"status":"connected"}\n\n`);

    // FIX #8: Gérer Last-Event-ID pour les reconnexions
    const lastEventId = req.headers['last-event-id'];
    if (lastEventId) {
      const lastId = parseInt(lastEventId, 10);
      const now = Date.now();
      const ttlMs = ALERT_TTL_MINUTES * 60 * 1000;
      const missedAlerts = alertBuffer.filter(alert =>
        alert.sse_id > lastId && (now - alert.createdAt) < ttlMs
      );
      for (const alert of missedAlerts) {
        // A-04: Filter by severity
        if (canReceiveScopedEvent(client, alert.user_id) &&
            (SEVERITY_ORDER[alert.severity] || 1) >= minSeverity) {
          res.write(formatSse('alert', alert, alert.sse_id));
          client.lastActivity = Date.now();
        }
      }
    }

    clients.add(client);

    req.on('close', () => {
      clients.delete(client);
    });

    return clientId;
  }

  removeClient(clientId) {
    for (const client of clients) {
      if (client.id === clientId) {
        client.res.end();
        clients.delete(client);
        return true;
      }
    }
    return false;
  }

  broadcast(event, data) {
    const msg = formatSse(event, data);
    for (const client of clients) {
      try {
        client.res.write(msg);
        client.lastActivity = Date.now();
      } catch (e) {
        clients.delete(client);
      }
    }
  }

  /** Diffusion d'un log en temps réel (page Watch Log) */
  broadcastLog(log) {
    const payload = normalizeLogPayload(log);
    this.broadcastScoped('log', payload, payload.user_id);
  }

  /** Diffusion par lots pour les imports volumineux sans saturer le flux alertes */
  broadcastLogBatch(logs, options = {}) {
    if (!Array.isArray(logs) || logs.length === 0) return;
    const userId = options.userId ?? options.user_id ?? null;
    const jobId = options.jobId ?? options.job_id ?? null;
    const payload = {
      event_type: 'log_batch',
      count: logs.length,
      user_id: userId,
      job_id: jobId,
      logs: logs.map(log => normalizeLogPayload({
        ...log,
        user_id: log.user_id ?? userId,
        job_id: log.job_id ?? jobId
      }))
    };
    this.broadcastScoped('log_batch', payload, userId);
  }

  broadcastScoped(event, data, userId) {
    const msg = formatSse(event, data);
    let sentCount = 0;
    for (const client of clients) {
      try {
        if (canReceiveScopedEvent(client, userId)) {
          client.res.write(msg);
          client.lastActivity = Date.now();
          sentCount++;
        }
      } catch (e) {
        clients.delete(client);
      }
    }
    logger.debug({ event: 'sse_broadcast', messageEvent: event, sentCount, userId: userId ?? 'all' }, '[SSE]');
  }

  broadcastAlert(alert) {
    // FIX #6: Scoper le broadcast par user_id
    // FIX #8: Ajouter un ID unique pour Last-Event-ID
    // A-02: Add createdAt for TTL tracking
    // P-12: Precompute alert metadata at creation time
    const now = Date.now();
    const alertWithId = { 
      ...alert, 
      sse_id: ++lastAlertId,
      createdAt: now,
      // P-12: Pre-compute metadata JSON for efficiency
      metadata: typeof alert.metadata === 'string' ? alert.metadata : JSON.stringify(alert.metadata || alert.context || {})
    };
    
    // Maintenir le buffer circulaire avec TTL
    const ttlMs = ALERT_TTL_MINUTES * 60 * 1000;
    // Purger les alertes expirées
    while (alertBuffer.length > 0 && (now - alertBuffer[0].createdAt) > ttlMs) {
      alertBuffer.shift();
    }
    alertBuffer.push(alertWithId);
    if (alertBuffer.length > ALERT_BUFFER_SIZE) {
      alertBuffer.shift();
    }
    
    const msg = formatSse('alert', alertWithId, alertWithId.sse_id);
    let sentCount = 0;
    for (const client of clients) {
      try {
        // Envoyer seulement si le client est concerné par l'alerte
        // ✅ BUG CRITIQUE #2 CORRIGÉ : les admins reçoivent toutes les alertes
        // A-04: Filter by minimum severity
        const alertSeverity = SEVERITY_ORDER[alertWithId.severity] || 1;
        if (canReceiveScopedEvent(client, alertWithId.user_id) &&
            alertSeverity >= client.minSeverity) {
          client.res.write(msg);
          client.lastActivity = Date.now();
          sentCount++;
        }
      } catch (e) {
        clients.delete(client);
      }
    }
    logger.debug({ event: 'sse_alert_broadcast', alertId: alertWithId.id, sentCount, userId: alertWithId.user_id }, '[SSE]');
  }

  closeAll() {
    for (const client of clients) {
      try {
        client.res.end();
      } catch (_) {}
    }
    clients.clear();
  }
}

export const alertWorker = new AlertWorker();

setInterval(() => {
  alertWorker.broadcast('heartbeat', { ts: Date.now() });
}, 30000).unref(); // ✅ Observation #9 CORRIGÉ : permet un arrêt propre

// Cleanup zombie connections > 90 seconds inactive
setInterval(() => {
  const now = Date.now();
  const timeout = 90 * 1000; // 90 seconds
  
    for (const client of clients) {
      const lastActivity = client.lastActivity || client.createdAt || now;
      if (now - lastActivity > timeout) {
        logger.debug({ event: 'sse_zombie_connection_closed', clientId: client.id, inactiveMs: now - lastActivity }, '[SSE]');
        try {
          client.res.end();
        } catch (_) {}
        clients.delete(client);
      }
    }
}, 30000).unref();

export default alertWorker;
