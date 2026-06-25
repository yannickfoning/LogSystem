import { Router } from 'express';
import logger from '../config/logger.js';
import pool from '../config/database.js';
import { requireAuth, requireAdmin, userScope } from '../middleware/auth.js';
import { startWatcher, stopWatcher, getWatcherStatus, detectAnomalies, getWatchStats } from '../services/watcherService.js';
import { recordAudit } from '../middleware/audit.js';
import { generateLogPdf } from '../lib/pdfExport.js';

const router = Router();
router.use(requireAuth);

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 50;
const LOG_COLUMNS = 'id, timestamp, created_time, imported_at, log_level, source, source_server, service, message, normalized_message, event_type, error_type, fingerprint, user_id, target_user, module, parser_format, timestamp_inferred, created_at, file_name, file_created_at, import_job_id, imported_by_user_id, log_source, log_user';

// ── Helper : filtres SQL partagés ─────────────────────────────────────────────
function buildFilters(query, userScopeFilter, useImportedAtForDateRange = false) {
  const { log_level, source, source_server, service, event_type, error_type, fingerprint, date_from, date_to, imported_from, imported_to, search, from_timestamp, to_timestamp, realtime } = query;
  let sql = userScopeFilter.sql;
  const params = [...userScopeFilter.params];

  if (log_level) { sql += ' AND log_level = ?';  params.push(log_level); }
  if (source)    { sql += ' AND source = ?';      params.push(source); }
  if (source_server) { sql += ' AND source_server = ?'; params.push(source_server); }
  if (service)   { sql += ' AND service = ?';     params.push(service); }
  if (event_type) { sql += ' AND event_type = ?'; params.push(event_type); }
  if (error_type) { sql += ' AND error_type = ?'; params.push(error_type); }
  if (fingerprint) { sql += ' AND fingerprint = ?'; params.push(fingerprint); }

  // Support pour le Monitoring Live (flux temps réel uniquement)
  if (realtime === 'true' || realtime === '1') {
    sql += " AND ingested_realtime = 1 AND source_type IN ('watch', 'api', 'manual')";
  }

  // FIX SEARCH-02: Valider le format des dates avant injection dans la requete
  const ISO_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/;
  if (date_from && ISO_RE.test(date_from)) { sql += ' AND timestamp >= ?';  params.push(date_from.replace('T',' ')); }
  if (date_to   && ISO_RE.test(date_to))   { sql += ' AND timestamp <= ?';  params.push(date_to.replace('T',' ')); }

  // New: explicit timestamp filters
  if (from_timestamp && ISO_RE.test(from_timestamp)) { sql += ' AND timestamp >= ?'; params.push(from_timestamp.replace('T',' ')); }
  if (to_timestamp && ISO_RE.test(to_timestamp)) { sql += ' AND timestamp <= ?'; params.push(to_timestamp.replace('T',' ')); }

  // New: explicit imported_at filters
  if (imported_from && ISO_RE.test(imported_from)) { sql += ' AND imported_at >= ?'; params.push(imported_from.replace('T',' ')); }
  if (imported_to && ISO_RE.test(imported_to)) { sql += ' AND imported_at <= ?'; params.push(imported_to.replace('T',' ')); }

  // after_id filter for polling (Vercel compatibility)
  if (query.after_id) {
    const afterId = parseInt(query.after_id, 10);
    if (!isNaN(afterId) && afterId > 0) {
      sql += ' AND id > ?';
      params.push(afterId);
    }
  }

  if (search) {
    // [FIX-PERF-01] FULLTEXT MATCH/AGAINST au lieu de LIKE '%...%' — utilise l'index ft_message
    const safeSearch = search.replace(/[<>()~*@"]/g, '').trim().substring(0, 200);
    if (safeSearch.length > 0) {
      // Tente d'abord FULLTEXT sur message/normalized_message, complète avec LIKE sur les autres colonnes
      sql += ' AND (MATCH(message, normalized_message) AGAINST(? IN BOOLEAN MODE) OR source LIKE ? OR source_server LIKE ? OR service LIKE ? OR target_user LIKE ? OR error_type LIKE ?)';
      const like = '%' + safeSearch + '%';
      params.push(safeSearch + '*', like, like, like, like, like);
    }
  }
  return { sql, params };
}

// ── Helper PDF row ────────────────────────────────────────────────────────────
function pdfTableRow(doc, cols, y, rowH, colX, colW, isHeader = false) {
  doc.save();
  if (isHeader) {
    doc.rect(colX[0], y, colX[cols.length - 1] + colW[cols.length - 1] - colX[0], rowH).fill('#2E75B6');
  }
  doc.restore();
  cols.forEach((text, i) => {
    doc.rect(colX[i], y, colW[i], rowH).stroke('#CCCCCC');
    doc.font(isHeader ? 'Helvetica-Bold' : 'Helvetica')
       .fontSize(isHeader ? 7 : 6.5)
       .fillColor(isHeader ? '#FFFFFF' : '#111111')
       .text(String(text).substring(0, 60), colX[i] + 3, y + 3, { width: colW[i] - 6, height: rowH - 4, ellipsis: true, lineBreak: false });
  });
}

// ── GET /export/csv ───────────────────────────────────────────────────────────
router.get('/export/csv', async (req, res) => {
  try {
    const userScopeFilter = userScope(req);
    const { sql: filters, params } = buildFilters(req.query, userScopeFilter);
    const [rows] = await pool.execute(
      `SELECT id, timestamp, imported_at, log_level, source, source_server, service, event_type, error_type, fingerprint, target_user, log_user, log_source, file_name, message FROM logs WHERE 1=1 ${filters} ORDER BY timestamp DESC LIMIT 10000`,
      params
    );
    if (rows.length >= 10000) {
      return res.status(422).json({ error: 'Trop de résultats (10K max). Affinez votre recherche.' });
    }
    const escape = v => `"${String(v ?? '').replace(/"/g, '""').replace(/[\n\r]/g, ' ')}"`;
    const header = ['ID', 'Date', 'Heure', 'Niveau', 'Source', 'Service', 'Utilisateur', 'Message', 'Importé le', 'Fichier', 'Source log'].map(escape).join(',');
    const body = rows.map(r => [
      r.id, String(r.timestamp ?? '').slice(0, 10), String(r.timestamp ?? '').slice(11, 19),
      r.log_level ?? '', r.source ?? '', r.service ?? '', (r.log_user || r.target_user || ''), r.message ?? '',
      r.imported_at ?? '', r.file_name ?? '', r.log_source ?? ''
    ].map(escape).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="logs_export_${new Date().toISOString().slice(0,10)}.csv"`);
    res.send('\uFEFF' + header + '\n' + body);
  } catch (e) {
    logger.error({ event: 'export_csv_failed', error: e.message }, '[EXPORT CSV]');
    res.status(500).json({ error: 'Erreur export CSV' });
  }
});

// ── GET /export/pdf ───────────────────────────────────────────────────────────
// BUG-01 FIX: Suppression de la ligne SQL dupliquée qui causait un SyntaxError
router.get('/export/pdf', async (req, res) => {
  try {
    const userScopeFilter = userScope(req);
    const { sql: filters, params } = buildFilters(req.query, userScopeFilter);
    const MAX_PDF_ROWS = 10000;
    const [countRows] = await pool.execute(
      `SELECT COUNT(*) as cnt FROM logs WHERE 1=1 ${filters}`,
      params
    );
    if (countRows[0].cnt > MAX_PDF_ROWS) {
      return res.status(422).json({ error: 'Trop de résultats pour PDF. Max 10K. Affinez votre recherche.' });
    }
    const [rows] = await pool.execute(
      `SELECT id, timestamp, imported_at, log_level, source, source_server, service, event_type, error_type, fingerprint, target_user, log_user, log_source, file_name, file_created_at, message FROM logs WHERE 1=1 ${filters} ORDER BY timestamp DESC LIMIT ${MAX_PDF_ROWS}`,
      params
    );

    const filterDesc = [
      req.query.log_level && `Niveau: ${req.query.log_level}`,
      req.query.source && `Source: ${req.query.source}`,
      req.query.date_from && `Depuis: ${req.query.date_from}`,
    ].filter(Boolean).join(', ');

    const pdfBuffer = await generateLogPdf(rows, {
      username: req.session.user.display_name || req.session.user.email,
      filters: filterDesc,
      orientation: req.query.orientation || 'portrait',
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="logs_export_${new Date().toISOString().slice(0,10)}.pdf"`);
    res.send(pdfBuffer);
  } catch (e) {
    logger.error({ event: 'export_pdf_failed', error: e.message }, '[EXPORT PDF]');
    if (!res.headersSent) res.status(500).json({ error: 'Erreur export PDF' });
  }
});

// ── GET /counts — group and facet counts for search filters ───────────────────
router.get('/counts', async (req, res) => {
  try {
    const userScopeFilter = userScope(req);
    const { sql: filters, params } = buildFilters(req.query, userScopeFilter);
    const [eventTypes] = await pool.execute(
      `SELECT COALESCE(event_type, 'Inconnu') as label, COUNT(*) as cnt
       FROM logs
       WHERE 1=1 ${filters}
       GROUP BY COALESCE(event_type, 'Inconnu')
       ORDER BY cnt DESC
       LIMIT 20`,
      params
    );
    const [errorTypes] = await pool.execute(
      `SELECT COALESCE(error_type, 'Inconnu') as label, COUNT(*) as cnt,
              MIN(timestamp) as first_seen, MAX(timestamp) as last_seen,
              COUNT(DISTINCT fingerprint) as fingerprints,
              COUNT(DISTINCT source_server) as servers
       FROM logs
       WHERE 1=1 ${filters}
       GROUP BY COALESCE(error_type, 'Inconnu')
       ORDER BY cnt DESC
       LIMIT 20`,
      params
    );
    const [fingerprints] = await pool.execute(
      `SELECT COALESCE(fingerprint, 'Sans empreinte') as label, COUNT(*) as cnt,
              MIN(timestamp) as first_seen, MAX(timestamp) as last_seen,
              MAX(error_type) as error_type, MAX(source_server) as source_server
       FROM logs
       WHERE 1=1 ${filters}
       GROUP BY COALESCE(fingerprint, 'Sans empreinte')
       ORDER BY cnt DESC
       LIMIT 20`,
      params
    );
    const [sourceServers] = await pool.execute(
      `SELECT COALESCE(source_server, source, 'Inconnu') as label, COUNT(*) as cnt
       FROM logs
       WHERE 1=1 ${filters}
       GROUP BY COALESCE(source_server, source, 'Inconnu')
       ORDER BY cnt DESC
       LIMIT 20`,
      params
    );
    res.json({ event_types: eventTypes, error_types: errorTypes, fingerprints, source_servers: sourceServers });
  } catch (e) {
    logger.error({ event: 'log_counts_failed', error: e.message }, '[LOG COUNTS]');
    res.status(500).json({ error: 'Erreur calcul des décomptes' });
  }
});

// ── GET / — listing avec keyset pagination ────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const userScopeFilter = userScope(req);
    const { limit = 50, sort = 'timestamp', order = 'desc', last_id,
            log_level, source, service, event_type, fingerprint, search, date_from, date_to } = req.query;

    const limitVal = Math.min(Math.max(parseInt(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const pageVal = parseInt(req.query.page, 10);
    const { sql: filterSql, params: filterParams } = buildFilters(req.query, userScopeFilter);

    const allowed = ['timestamp', 'log_level', 'source', 'service', 'event_type', 'id'];
    const sortBy  = allowed.includes(sort) ? sort : 'timestamp';
    const orderBy = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // Pagination par page (page Recherche)
    if (pageVal > 0 && !last_id) {
      const [totalRows] = await pool.execute(
        `SELECT COUNT(*) as total FROM logs WHERE 1=1 ${filterSql}`,
        filterParams
      );
      const total = totalRows[0].total;
      const pages = Math.max(1, Math.ceil(total / limitVal));
      const offset = (pageVal - 1) * limitVal;
      const [rows] = await pool.execute(
        `SELECT ${LOG_COLUMNS} FROM logs WHERE 1=1 ${filterSql} ORDER BY ${sortBy} ${orderBy} LIMIT ${limitVal} OFFSET ${offset}`,
        filterParams
      );
      return res.json({
        data: rows,
        pagination: { page: pageVal, pages, total, limit: limitVal }
      });
    }

    // Keyset pagination (curseur)
    let sql = `SELECT ${LOG_COLUMNS} FROM logs WHERE 1=1 ${filterSql}`;
    const params = [...filterParams];
    if (last_id) {
      sql += ' AND id < ?';
      params.push(last_id);
    }
    sql += ` ORDER BY ${sortBy} ${orderBy} LIMIT ${limitVal + 1}`;

    const [rows] = await pool.execute(sql, params);

    const hasMore = rows.length > limitVal;
    const data = hasMore ? rows.slice(0, limitVal) : rows;
    const nextCursor = data.length > 0 ? data[data.length - 1].id : null;

    res.json({ data, pagination: { cursor: nextCursor, has_more: hasMore, limit: limitVal } });
  } catch (e) {
    logger.error({ event: 'logs_get_failed', error: e.message }, '[LOGS GET]');
    res.status(500).json({ error: 'Erreur récupération logs' });
  }
});

// ── GET /logs/analysis/:fingerprint ─────────────────────────────────────────
router.get('/analysis/:fingerprint', async (req, res) => {
  try {
    const scope = userScope(req);
    const { fingerprint } = req.params;

    const [groups] = await pool.execute(
      `SELECT fingerprint, COUNT(*) as occurrences,
              MIN(COALESCE(event_timestamp, timestamp, imported_at)) as first_seen,
              MAX(COALESCE(event_timestamp, timestamp, imported_at)) as last_seen,
              MAX(log_level) as severity_max,
              COUNT(DISTINCT service) as service_count,
              COUNT(DISTINCT source_server) as source_server_count
       FROM logs WHERE fingerprint = ? ${scope.sql}
       GROUP BY fingerprint`,
      [fingerprint, ...scope.params]
    );

    if (groups.length === 0) {
      return res.status(404).json({ error: 'Groupe d\'erreur non trouvé' });
    }

    const group = groups[0];
    const [affected] = await pool.execute(
      `SELECT DISTINCT module, target_user, source_server, service FROM logs
       WHERE fingerprint = ? ${scope.sql}
       ORDER BY timestamp DESC LIMIT 50`,
      [fingerprint, ...scope.params]
    );

    const modules = [...new Set(affected.map(a => a.module).filter(Boolean))];
    const users = [...new Set(affected.map(a => a.target_user).filter(Boolean))];
    const servers = [...new Set(affected.map(a => a.source_server).filter(Boolean))];
    const services = [...new Set(affected.map(a => a.service).filter(Boolean))];
    const [samples] = await pool.execute(
      `SELECT error_type, message, stack_trace, log_level, imported_at, created_time, source_server, service FROM logs
       WHERE fingerprint = ? ${scope.sql}
       ORDER BY timestamp DESC LIMIT 1`,
      [fingerprint, ...scope.params]
    );

    const sample = samples[0] || {};
    const [metaRows] = await pool.execute(
      `SELECT status, previous_seen, returned_at, return_reason, return_count
       FROM error_groups WHERE fingerprint = ? ${scope.sql} LIMIT 1`,
      [fingerprint, ...scope.params]
    );
    const meta = metaRows[0] || {};
    const suggestion = generateSuggestion(sample.error_type, sample.message, sample.stack_trace);

    res.json({
      fingerprint,
      occurrences: group.occurrences,
      first_seen: group.first_seen,
      last_seen: group.last_seen,
      severity_max: group.severity_max,
      service_count: group.service_count,
      source_server_count: group.source_server_count,
      affected_modules: modules,
      affected_users: users,
      affected_servers: servers,
      affected_services: services,
      error_type: sample.error_type,
      log_level: sample.log_level,
      imported_at: sample.imported_at,
      source_server: sample.source_server,
      service: sample.service,
      message: sample.message,
      stack_trace: sample.stack_trace,
      status: meta.status,
      previous_seen: meta.previous_seen,
      returned_at: meta.returned_at,
      return_reason: meta.return_reason,
      return_count: meta.return_count,
      suggestion
    });
  } catch (e) {
    logger.error({ event: 'analysis_failed', error: e.message }, '[ANALYSIS]');
    res.status(500).json({ error: 'Erreur lors de l\'analyse' });
  }
});

/* AMÉLIORATION 4: Server-Sent Events (SSE) for real-time watch stream */
router.get('/watch/stream', async (req, res) => {
  try {
    const user = req.session?.user;
    if (!user) {
      return res.status(401).json({ error: 'Authentification requise' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // On Vercel: close immediately after connected event to prevent MySQL pool exhaustion
    // Frontend will fall back to polling automatically
    const isVercelEnv = !!(process.env.VERCEL || process.env.VERCEL_ENV);
    if (isVercelEnv) {
      res.flushHeaders();
      res.write('event: connected\n');
      res.write(`data: ${JSON.stringify({ connected: false, mode: 'polling', reason: 'vercel_serverless', user_id: user.id })}\n\n`);
      setTimeout(() => { try { res.end(); } catch(_){} }, 100);
      return;
    }

    res.flushHeaders();
    res.write('event: connected\n');
    res.write(`data: ${JSON.stringify({ connected: true, user_id: user.id })}\n\n`);

    let isConnected = true;
    let statsInterval;
    let anomalyInterval;

    statsInterval = setInterval(async () => {
      if (!isConnected) return;
      try {
        const stats = await getWatchStats(user.id);
        res.write('event: stats_update\n');
        res.write(`data: ${JSON.stringify(stats)}\n\n`);
      } catch (e) {
        logger.error({ event: 'watch_stream_stats_error', error: e.message }, '[WATCH STREAM]');
      }
    }, 10000);

    anomalyInterval = setInterval(async () => {
      if (!isConnected) return;
      try {
        const anomaly = await detectAnomalies(user.id, 10);
        if (anomaly.anomaly_detected) {
          res.write('event: anomaly_detected\n');
          res.write(`data: ${JSON.stringify(anomaly)}\n\n`);
        }
      } catch (e) {
        logger.error({ event: 'watch_stream_anomaly_error', error: e.message }, '[WATCH STREAM]');
      }
    }, 5 * 60 * 1000);

    req.on('close', () => {
      isConnected = false;
      clearInterval(statsInterval);
      clearInterval(anomalyInterval);
    });

    const heartbeat = setInterval(() => {
      if (isConnected) {
        res.write(':heartbeat\n\n');
      }
    }, 30000);

    req.on('close', () => {
      clearInterval(heartbeat);
    });
  } catch (error) {
    logger.error({ event: 'watch_stream_error', error: error.message }, '[WATCH STREAM]');
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

/* AMÉLIORATION 4: Get current watch statistics */
router.get('/watch/stats', async (req, res) => {
  try {
    const user = req.session?.user;
    if (!user) {
      return res.status(401).json({ error: 'Authentification requise' });
    }
    const stats = await getWatchStats(user.id);
    res.json(stats);
  } catch (error) {
    logger.error({ event: 'watch_stats_failed', error: error.message }, '[WATCH STATS]');
    res.status(500).json({ error: error.message });
  }
});

/* AMÉLIORATION 4: Check for anomalies */
router.get('/watch/anomalies', async (req, res) => {
  try {
    const user = req.session?.user;
    if (!user) {
      return res.status(401).json({ error: 'Authentification requise' });
    }
    const windowMinutes = parseInt(req.query.window) || 10;
    const anomaly = await detectAnomalies(user.id, windowMinutes);
    res.json(anomaly);
  } catch (error) {
    logger.error({ event: 'watch_anomalies_failed', error: error.message }, '[WATCH ANOMALIES]');
    res.status(500).json({ error: error.message });
  }
});

router.get('/directory', async (req, res) => {
  try {
    const userScopeFilter = userScope(req);
    const { sql: filters, params } = buildFilters(req.query, userScopeFilter);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '100', 10), 1), 500);
    const [rows] = await pool.execute(
      `SELECT
         COALESCE(source_server, source, 'Inconnu') as source_server,
         COALESCE(service, 'Inconnu') as service,
         COALESCE(error_type, event_type, 'generic') as error_type,
         fingerprint,
         COUNT(*) as occurrence_count,
         MIN(timestamp) as first_seen,
         MAX(timestamp) as last_seen,
         MIN(imported_at) as first_imported_at,
         MAX(imported_at) as last_imported_at,
         MAX(log_level) as severity_max
       FROM logs
       WHERE 1=1 ${filters}
       GROUP BY COALESCE(source_server, source, 'Inconnu'), COALESCE(service, 'Inconnu'), COALESCE(error_type, event_type, 'generic'), fingerprint
       ORDER BY occurrence_count DESC, last_seen DESC
       LIMIT ${limit}`,
      params
    );
    res.json({ data: rows });
  } catch (e) {
    logger.error({ event: 'log_directory_failed', error: e.message }, '[LOG DIRECTORY]');
    res.status(500).json({ error: 'Erreur repertoire des logs' });
  }
});

// ── GET /:id — PERF-01 FIX: colonne explicite, pas SELECT * ──────────────────
router.get('/:id', async (req, res) => {
  try {
    const scope = userScope(req);
    const cols = 'id, timestamp, created_time, imported_at, timezone, log_level, source, source_server, service, message, normalized_message, event_type, fingerprint, user_id, client_ip, module, error_type, stack_trace, target_user, raw_log, parser_format, timestamp_inferred, classification_confidence, created_at, file_name, file_created_at, import_job_id, imported_by_user_id, log_source, log_user';
    const [rows] = await pool.execute(`SELECT ${cols} FROM logs WHERE id = ?` + scope.sql, [req.params.id, ...scope.params]);
    if (!rows.length) return res.status(404).json({ error: 'Log non trouvé' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
// (Placeholder - DELETE endpoint for logs if implemented)

// ──  AMÉLIORATION 2 & 6: Alert Management Endpoints ──────────────────────────────

// ── DELETE /api/alerts/:id ────────────────────────────────────────────────────
// AMÉLIORATION 2: Delete alert with user isolation
router.delete('/alerts/:id', async (req, res) => {
  try {
    const userId = req.session.user.id;
    const alertId = req.params.id;
    
    // Verify alert belongs to user
    const [alerts] = await pool.execute(
      'SELECT id FROM alerts WHERE id = ? AND user_id = ?',
      [alertId, userId]
    );
    
    if (alerts.length === 0) {
      return res.status(404).json({ error: 'Alerte non trouvée ou non autorisée' });
    }
    
    // Soft delete - mark as resolved
    await pool.execute(
      'UPDATE alerts SET resolved_at = NOW(), status = ? WHERE id = ?',
      ['resolved', alertId]
    );
    
    res.json({ success: true, id: alertId });
  } catch (e) {
    logger.error({ event: 'alert_delete_failed', error: e.message }, '[ALERT DELETE]');
    res.status(500).json({ error: 'Erreur lors de la suppression de l\'alerte' });
  }
});

// Helper function for error suggestions (AMÉLIORATION 6)
function generateSuggestion(errorType, message, stackTrace) {
  const msg = String(message || '').toLowerCase();
  const stack = String(stackTrace || '').toLowerCase();
  const err = String(errorType || '').toUpperCase();
  
  const suggestions = {
    'ECONNREFUSED': 'Vérifiez que le service cible est démarré et accessible sur le port indiqué.',
    'ETIMEDOUT': 'Augmentez le timeout ou vérifiez la latence réseau vers l\'hôte distant.',
    'ENOENT': 'Le fichier ou répertoire est introuvable. Vérifiez le chemin et les permissions.',
    'ER_ACCESS_DENIED_ERROR': 'Identifiants de base de données incorrects. Vérifiez DB_USER et DB_PASSWORD.',
    'SYNTAXERROR': 'Erreur de syntaxe dans le code. Vérifiez la ligne indiquée dans la stack trace.',
    'TYPEERROR': 'Une variable est null ou de type inattendu. Ajoutez des vérifications de type.',
  };
  
  // Check error type first
  if (suggestions[err]) return suggestions[err];
  
  // Check message patterns
  if (msg.includes('401') || msg.includes('unauthorized')) {
    return 'Erreur d\'authentification. Vérifiez les tokens et les identifiants.';
  }
  if (msg.includes('403') || msg.includes('forbidden')) {
    return 'Erreur d\'autorisation. Vérifiez les droits d\'accès et les permissions.';
  }
  if (msg.includes('500') || msg.includes('internal server')) {
    return 'Erreur serveur interne. Consultez les logs du serveur pour plus de détails.';
  }
  if (msg.includes('cannot read') || msg.includes('cannot set')) {
    return 'Une propriété est accédée sur une valeur null/undefined. Ajoutez une vérification null.';
  }
  if (msg.includes('out of memory') || msg.includes('heap')) {
    return 'Mémoire insuffisante. Vérifiez les fuites mémoire ou augmentez --max-old-space-size.';
  }
  if (msg.includes('deadlock')) {
    return 'Deadlock détecté en base de données. Revisitez la logique de transation.';
  }
  
  // Default suggestion
  return 'Aucune suggestion automatique disponible. Consultez la documentation du module ou la communauté.';
}
router.delete('/:id', async (req, res) => {
  try {
    const logId = parseInt(req.params.id);
    if (isNaN(logId)) return res.status(400).json({ error: 'ID invalide' });

    const user = req.session?.user;
    if (!user) return res.status(401).json({ error: 'Authentification requise' });

    if (user.role === 'admin') {
      const [result] = await pool.execute('DELETE FROM logs WHERE id = ?', [logId]);
      if (!result.affectedRows) return res.status(404).json({ error: 'Log non trouvé' });
      await recordAudit({ userId: user.id, userEmail: user.email, action: 'delete_log', resourceType: 'log', resourceId: String(logId), details: `Admin deleted log ${logId}`, ipAddress: req.ip });
      return res.json({ success: true });
    }

    const scope = userScope(req);
    const [result] = await pool.execute('DELETE FROM logs WHERE id = ?' + scope.sql, [logId, ...scope.params]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Log non trouvé ou accès refusé' });

    await recordAudit({ userId: user.id, userEmail: user.email, action: 'delete_log', resourceType: 'log', resourceId: String(logId), details: `User deleted own log ${logId}`, ipAddress: req.ip });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;