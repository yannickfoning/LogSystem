/**
 * External Log Source Service - Polling system for Vercel-compatible log ingestion
 * Replaces file watching with HTTP polling of external log sources
 */

import logger from '../config/logger.js';
import pool from '../config/database.js';
import crypto from 'crypto';
import fetch from 'node-fetch';

// Polling intervals (in milliseconds)
const POLL_INTERVALS = {
  realtime: 10000,    // 10 seconds
  frequent: 60000,    // 1 minute
  normal: 300000,     // 5 minutes
  slow: 900000        // 15 minutes
};

const activePollers = new Map(); // sourceId -> timer

/**
 * Initialize external log sources from database
 */
export async function initializeExternalSources() {
  try {
    const [sources] = await pool.execute(
      'SELECT * FROM external_log_sources WHERE is_active = 1'
    );

    for (const source of sources) {
      startPolling(source);
    }

    logger.info({ 
      event: 'external_sources_initialized', 
      count: sources.length 
    }, '[EXTERNAL_SOURCES]');

    return sources.length;
  } catch (e) {
    logger.error({ event: 'external_sources_init_failed', error: e.message }, '[EXTERNAL_SOURCES]');
    return 0;
  }
}

/**
 * Start polling for a specific external log source
 */
export function startPolling(source) {
  if (activePollers.has(source.id)) {
    stopPolling(source.id);
  }

  const interval = POLL_INTERVALS[source.poll_interval] || POLL_INTERVALS.normal;
  
  const poller = setInterval(async () => {
    try {
      await pollSource(source);
    } catch (e) {
      logger.error({ 
        event: 'poll_failed', 
        sourceId: source.id, 
        sourceName: source.name,
        error: e.message 
      }, '[EXTERNAL_SOURCES]');
    }
  }, interval);

  activePollers.set(source.id, {
    timer: poller,
    source: source,
    interval: interval,
    lastPoll: null,
    pollCount: 0
  });

  logger.info({ 
    event: 'polling_started', 
    sourceId: source.id, 
    sourceName: source.name,
    interval 
  }, '[EXTERNAL_SOURCES]');
}

/**
 * Stop polling for a specific source
 */
export function stopPolling(sourceId) {
  const poller = activePollers.get(sourceId);
  if (poller) {
    clearInterval(poller.timer);
    activePollers.delete(sourceId);
    logger.info({ event: 'polling_stopped', sourceId }, '[EXTERNAL_SOURCES]');
  }
}

/**
 * Stop all active pollers
 */
export function stopAllPolling() {
  for (const [sourceId, poller] of activePollers) {
    clearInterval(poller.timer);
  }
  activePollers.clear();
  logger.info({ event: 'all_polling_stopped' }, '[EXTERNAL_SOURCES]');
}

/**
 * Poll a single external log source
 */
async function pollSource(source) {
  const poller = activePollers.get(source.id);
  if (!poller) return;

  poller.lastPoll = new Date();
  poller.pollCount++;

  logger.debug({ 
    event: 'polling_source', 
    sourceId: source.id, 
    sourceName: source.name,
    pollCount: poller.pollCount 
  }, '[EXTERNAL_SOURCES]');

  try {
    let logs = [];

    switch (source.source_type) {
      case 'http_json':
        logs = await pollHttpJson(source);
        break;
      case 'http_lines':
        logs = await pollHttpLines(source);
        break;
      case 'webhook':
        // Webhooks are passive - no polling needed
        logger.debug({ event: 'webhook_passive', sourceId: source.id }, '[EXTERNAL_SOURCES]');
        return;
      default:
        logger.warn({ 
          event: 'unknown_source_type', 
          sourceType: source.source_type 
        }, '[EXTERNAL_SOURCES]');
        return;
    }

    if (logs.length > 0) {
      await ingestLogs(logs, source);
      
      // Update last successful poll
      await pool.execute(
        'UPDATE external_log_sources SET last_poll_at = NOW(), last_poll_status = ?, poll_count = poll_count + 1 WHERE id = ?',
        ['success', source.id]
      );
    } else {
      await pool.execute(
        'UPDATE external_log_sources SET last_poll_at = NOW(), last_poll_status = ?, poll_count = poll_count + 1 WHERE id = ?',
        ['no_data', source.id]
      );
    }

  } catch (e) {
    await pool.execute(
      'UPDATE external_log_sources SET last_poll_at = NOW(), last_poll_status = ?, last_error = ?, poll_count = poll_count + 1 WHERE id = ?',
      ['error', e.message, source.id]
    );
    throw e;
  }
}

/**
 * Poll HTTP JSON endpoint
 */
async function pollHttpJson(source) {
  const headers = {};
  if (source.auth_token) {
    headers['Authorization'] = `Bearer ${source.auth_token}`;
  }
  if (source.custom_headers) {
    try {
      const customHeaders = JSON.parse(source.custom_headers);
      Object.assign(headers, customHeaders);
    } catch (e) {
      logger.warn({ event: 'invalid_custom_headers', error: e.message }, '[EXTERNAL_SOURCES]');
    }
  }

  const response = await fetch(source.endpoint_url, {
    method: 'GET',
    headers: headers,
    timeout: 30000
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  
  // Support different JSON structures
  if (Array.isArray(data)) {
    return data;
  } else if (data.logs && Array.isArray(data.logs)) {
    return data.logs;
  } else if (data.data && Array.isArray(data.data)) {
    return data.data;
  } else if (data.items && Array.isArray(data.items)) {
    return data.items;
  } else {
    // Single log object
    return [data];
  }
}

/**
 * Poll HTTP text/lines endpoint
 */
async function pollHttpLines(source) {
  const headers = {};
  if (source.auth_token) {
    headers['Authorization'] = `Bearer ${source.auth_token}`;
  }

  const response = await fetch(source.endpoint_url, {
    method: 'GET',
    headers: headers,
    timeout: 30000
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const text = await response.text();
  const lines = text.split('\n').filter(line => line.trim());
  
  // Convert lines to log objects
  return lines.map((line, index) => ({
    message: line,
    timestamp: new Date().toISOString(),
    source: source.name,
    line_number: index + 1
  }));
}

/**
 * Ingest logs from external source into database
 */
async function ingestLogs(logs, source) {
  if (logs.length === 0) return;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { normalizeLevel } = await import('../config/database.js');
    const { normalizeMessage } = await import('../lib/processing/normalize.js');
    const { classifyLog } = await import('../lib/processing/classify.js');
    const { generateFingerprint } = await import('../lib/processing/fingerprint.js');
    const { enrichLogMetadata } = await import('../lib/processing/logMetadata.js');
    const { alertEngineBus } = await import('./alertEngine.js');

    const batchId = crypto.randomUUID();
    let successCount = 0;

    for (const logEntry of logs) {
      try {
        const normalizedLevel = normalizeLevel(logEntry.level || 'INFO');
        const normalizedMessage = normalizeMessage(logEntry.message || '');
        const eventType = classifyLog(normalizedMessage, logEntry.service || source.name, source.name);
        
        const enriched = enrichLogMetadata({
          timestamp: logEntry.timestamp || new Date().toISOString(),
          log_level: normalizedLevel,
          message: logEntry.message || '',
          normalized_message: normalizedMessage,
          event_type: eventType,
          service: logEntry.service || source.service_name || source.name,
          module: logEntry.module || null,
          source: source.name,
          source_server: logEntry.source_server || source.name,
          error_type: logEntry.error_type || null,
          stack_trace: logEntry.stack_trace || null,
          target_user: logEntry.target_user || null,
          log_user: logEntry.user_id || null,
          user_id: source.user_id,
          parser_format: 'external-http',
          source_type: 'external',
          imported_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
          timestamp_inferred: !logEntry.timestamp ? 1 : 0,
          classification_confidence: null,
          batch_id: batchId,
          external_source_id: source.id
        }, {
          format: 'external-http',
          source_type: 'external',
          filePath: null
        });

        enriched.fingerprint = generateFingerprint(
          enriched.service,
          enriched.event_type,
          enriched.normalized_message,
          source.user_id
        );

        await conn.execute(
          `INSERT INTO logs (
            timestamp, event_timestamp, created_time, imported_at, log_level, 
            message, normalized_message, event_type, fingerprint, service, 
            module, source, source_server, error_type, stack_trace, 
            target_user, log_user, user_id, parser_format, source_type, 
            timestamp_inferred, classification_confidence, batch_id, external_source_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            enriched.timestamp,
            enriched.timestamp,
            enriched.created_time,
            enriched.imported_at,
            enriched.log_level,
            enriched.message,
            enriched.normalized_message,
            enriched.event_type,
            enriched.fingerprint,
            enriched.service,
            enriched.module,
            enriched.source,
            enriched.source_server,
            enriched.error_type,
            enriched.stack_trace,
            enriched.target_user,
            enriched.log_user,
            enriched.user_id,
            enriched.parser_format,
            enriched.source_type,
            enriched.timestamp_inferred,
            enriched.classification_confidence,
            enriched.batch_id,
            enriched.external_source_id
          ]
        );

        // Trigger alert engine
        if (['ERROR', 'CRITICAL', 'FATAL'].includes(normalizedLevel)) {
          alertEngineBus.emit('log', enriched);
        }

        successCount++;
      } catch (err) {
        logger.error({ event: 'external_log_ingest_failed', error: err.message }, '[EXTERNAL_SOURCES]');
      }
    }

    await conn.commit();

    logger.info({ 
      event: 'external_logs_ingested', 
      sourceId: source.id, 
      sourceName: source.name,
      count: successCount,
      batchId 
    }, '[EXTERNAL_SOURCES]');

    return successCount;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * Get status of all active pollers
 */
export function getPollerStatus() {
  const IS_VERCEL = !!(process.env.VERCEL || process.env.VERCEL_ENV);
  
  if (IS_VERCEL) {
    return {
      platform: 'vercel',
      active: false,
      message: 'External polling requires persistent server. Use HTTP ingestion or webhooks instead.',
      pollers: []
    };
  }

  const pollers = [];
  for (const [sourceId, poller] of activePollers) {
    pollers.push({
      sourceId,
      sourceName: poller.source.name,
      interval: poller.interval,
      lastPoll: poller.lastPoll,
      pollCount: poller.pollCount
    });
  }

  return {
    platform: 'standard',
    active: true,
    pollerCount: pollers.length,
    pollers
  };
}