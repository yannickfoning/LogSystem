import { Router } from 'express';
import logger from '../config/logger.js';
import pool from '../config/database.js';
import { requireAuth, userScope } from '../middleware/auth.js';
import { ingestLimiter } from '../lib/rateLimiter.js';
import { normalizeLevel } from '../config/database.js';
import { normalizeMessage } from '../lib/processing/normalize.js';
import { classifyLog } from '../lib/processing/classify.js';
import { generateFingerprint } from '../lib/processing/fingerprint.js';
import { enrichLogMetadata } from '../lib/processing/logMetadata.js';
import { alertEngineBus, evalAllForUser } from '../services/alertEngine.js';
import crypto from 'crypto';

const router = Router();
router.use(requireAuth);
router.use(ingestLimiter);

/**
 * POST /api/logs/ingest
 * 
 * Endpoint d'ingestion HTTP pour les logs en temps réel (compatible Vercel)
 * Les applications peuvent envoyer leurs logs via HTTP POST au lieu de file watching
 * 
 * Body attendu:
 * {
 *   logs: [
 *     {
 *       timestamp: "2026-06-22T10:30:00Z",
 *       level: "ERROR",
 *       message: "Database connection failed",
 *       service: "api-service",
 *       module: "database",
 *       source: "server-1",
 *       error_type: "ConnectionError",
 *       stack_trace: "...",
 *       user_id: 123,
 *       target_user: "user@example.com",
 *       custom_fields: { ... }
 *     }
 *   ],
 *   batch_id: "optional-batch-identifier"
 * }
 */
router.post('/ingest', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const scope = userScope(req);
    const userId = req.session?.user?.id;
    const { logs = [], batch_id = null } = req.body;

    if (!Array.isArray(logs) || logs.length === 0) {
      return res.status(400).json({ error: 'Logs array is required and must not be empty' });
    }

    if (logs.length > 1000) {
      return res.status(413).json({ error: 'Too many logs in batch (max 1000)' });
    }

    await conn.beginTransaction();

    const ingestResults = {
      success: 0,
      failed: 0,
      errors: [],
      batch_id: batch_id || crypto.randomUUID()
    };

    for (const logEntry of logs) {
      try {
        const normalizedLevel = normalizeLevel(logEntry.level || 'INFO');
        const normalizedMessage = normalizeMessage(logEntry.message || '');
        const eventType = classifyLog(normalizedMessage, logEntry.service || 'http-ingest', logEntry.service);
        
        const enriched = enrichLogMetadata({
          timestamp: logEntry.timestamp || new Date().toISOString(),
          log_level: normalizedLevel,
          message: logEntry.message || '',
          normalized_message: normalizedMessage,
          event_type: eventType,
          service: logEntry.service || 'unknown',
          module: logEntry.module || null,
          source: logEntry.source || 'http-ingest',
          source_server: logEntry.source_server || logEntry.source || 'http-ingest',
          error_type: logEntry.error_type || null,
          stack_trace: logEntry.stack_trace || null,
          target_user: logEntry.target_user || null,
          log_user: logEntry.user_id || null,
          user_id: userId, // Override with authenticated user ID for multi-tenant
          parser_format: 'http-ingest',
          source_type: 'http',
          imported_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
          timestamp_inferred: !logEntry.timestamp ? 1 : 0,
          classification_confidence: null,
          custom_fields: logEntry.custom_fields || null,
          batch_id: ingestResults.batch_id
        }, {
          format: 'http-ingest',
          source_type: 'http',
          filePath: null
        });

        enriched.fingerprint = generateFingerprint(
          enriched.service,
          enriched.event_type,
          enriched.normalized_message,
          userId
        );

        // Insert log with scope
        const insertSql = `
          INSERT INTO logs (
            timestamp, event_timestamp, created_time, imported_at, log_level, 
            message, normalized_message, event_type, fingerprint, service, 
            module, source, source_server, error_type, stack_trace, 
            target_user, log_user, user_id, parser_format, source_type, 
            timestamp_inferred, classification_confidence, batch_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ` + scope.sql;

        const insertParams = [
          enriched.timestamp,
          enriched.timestamp, // event_timestamp same as timestamp for HTTP ingest
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
          ...scope.params
        ];

        await conn.execute(insertSql, insertParams);

        ingestResults.success++;
      } catch (err) {
        ingestResults.failed++;
        ingestResults.errors.push({
          message: logEntry.message?.substring(0, 100) || 'unknown',
          error: err.message
        });
        logger.error({ event: 'log_ingest_failed', error: err.message, logEntry }, '[INGEST]');
      }
    }

    await conn.commit();

    if (userId && ingestResults.success > 0) {
      const isVercel = !!(process.env.VERCEL || process.env.VERCEL_ENV);
      if (isVercel) {
        try {
          await evalAllForUser(userId);
        } catch (alertErr) {
          logger.error({ event: 'ingest_alert_eval_failed', userId, error: alertErr.message }, '[INGEST]');
        }
      } else {
        alertEngineBus.emit('logs.inserted', { userId, count: ingestResults.success });
      }
    }

    res.json({
      success: true,
      batch_id: ingestResults.batch_id,
      results: ingestResults
    });

  } catch (e) {
    await conn.rollback();
    logger.error({ event: 'ingest_batch_failed', error: e.message }, '[INGEST]');
    res.status(500).json({ error: 'Batch ingestion failed', details: e.message });
  } finally {
    conn.release();
  }
});

/**
 * POST /api/logs/ingest/single
 * 
 * Endpoint simplifié pour l'ingestion d'un log unique
 * Plus facile à intégrer pour les applications existantes
 */
router.post('/ingest/single', async (req, res) => {
  try {
    const result = await req.app.ingestLog(req.body, req.session?.user?.id);
    res.json(result);
  } catch (e) {
    logger.error({ event: 'single_ingest_failed', error: e.message }, '[INGEST]');
    res.status(500).json({ error: 'Single log ingestion failed', details: e.message });
  }
});

/**
 * GET /api/logs/ingest/stats
 * 
 * Statistiques d'ingestion pour le dashboard
 */
router.get('/ingest/stats', async (req, res) => {
  try {
    const scope = userScope(req);
    const [stats] = await pool.execute(
      `SELECT 
        COUNT(*) as total_ingested,
        COUNT(CASE WHEN source_type = 'http' THEN 1 END) as http_ingested,
        COUNT(CASE WHEN source_type = 'watch' THEN 1 END) as watch_ingested,
        COUNT(DISTINCT batch_id) as batch_count,
        MAX(imported_at) as last_ingest
       FROM logs 
       WHERE source_type IN ('http', 'watch')${scope.sql}`,
      scope.params
    );

    const [recentBatches] = await pool.execute(
      `SELECT batch_id, COUNT(*) as log_count, MIN(imported_at) as first_ingest, MAX(imported_at) as last_ingest
       FROM logs 
       WHERE batch_id IS NOT NULL${scope.sql}
       GROUP BY batch_id 
       ORDER BY last_ingest DESC 
       LIMIT 10`,
      scope.params
    );

    res.json({
      stats: stats[0] || {},
      recent_batches: recentBatches
    });
  } catch (e) {
    logger.error({ event: 'ingest_stats_failed', error: e.message }, '[INGEST]');
    res.status(500).json({ error: 'Failed to fetch ingestion stats' });
  }
});

export default router;