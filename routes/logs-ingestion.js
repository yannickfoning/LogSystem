import { Router } from "express";
import logger from "../config/logger.js";
import pool from "../config/database.js";
import { requireAuth, userScope } from "../middleware/auth.js";
import { ingestLimiter } from "../lib/rateLimiter.js";
import { normalizeLevel } from "../services/logLevelUtils.js";
import { normalizeMessage } from "../lib/processing/normalize.js";
import { classifyLog } from "../lib/processing/classify.js";
import { generateFingerprint } from "../lib/processing/fingerprint.js";
import { enrichLogMetadata } from "../lib/processing/logMetadata.js";
import { triggerPostIngestAlerts } from "../services/alertEngine.js";
import { OPERATIONAL_TS } from "../lib/operationalTime.js";
import crypto from 'crypto';

const router = Router();
router.use(requireAuth);
router.use(ingestLimiter);

/**
 * POST /api/logs/ingest
 * 
 * Endpoint d'ingestion HTTP pour les logs en temps réel
 * Les applications peuvent envoyer leurs logs via HTTP POST au lieu de file watching
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
          user_id: userId,
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

        const insertSql = `
          INSERT INTO logs (
            timestamp, created_time, imported_at, log_level,
            message, normalized_message, event_type, fingerprint, service,
            module, source, source_server, error_type, stack_trace,
            target_user, user_id, parser_format, source_type,
            timestamp_inferred, classification_confidence, batch_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ` + scope.sql;

        const insertParams = [
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
      await triggerPostIngestAlerts(userId, ingestResults.success);
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

/**
 * GET /api/logs/watch/stats
 * Statistiques en temps réel pour watchlog
 */
router.get('/watch/stats', async (req, res) => {
  try {
    const scope = userScope(req);
    const userIdClause = scope.sql;
    const userIdParams = scope.params;

    // Logs des dernières 24h
    const [logs] = await pool.execute(
      `SELECT 
        COUNT(*) as total_logs,
        SUM(CASE WHEN log_level IN ('ERROR','CRITICAL','FATAL') THEN 1 ELSE 0 END) as error_count,
        SUM(CASE WHEN log_level = 'CRITICAL' THEN 1 ELSE 0 END) as critical_count,
        SUM(CASE WHEN log_level = 'FATAL' THEN 1 ELSE 0 END) as fatal_count,
        COUNT(DISTINCT service) as services
       FROM logs
       WHERE ${OPERATIONAL_TS} >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
       ${userIdClause}`,
      userIdParams
    );

    // Logs/minute (dernières 5 minutes)
    const [logsPerMin] = await pool.execute(
      `SELECT COUNT(*) / 5.0 as logs_per_min
       FROM logs
       WHERE ${OPERATIONAL_TS} >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)
       ${userIdClause}`,
      userIdParams
    );

    res.json({
      stats: {
        total_logs: logs[0]?.total_logs || 0,
        error_count: logs[0]?.error_count || 0,
        critical_count: logs[0]?.critical_count || 0,
        fatal_count: logs[0]?.fatal_count || 0,
        services: logs[0]?.services || 0,
        logs_per_min: Math.round(logsPerMin[0]?.logs_per_min || 0)
      }
    });
  } catch (e) {
    logger.error({ event: 'watchlog_stats_error', error: e.message }, '[WATCHLOG]');
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * GET /api/logs/trending-by-hour
 * Tendances par heure (24h) - FIX pour watchlog
 */
router.get('/trending-by-hour', async (req, res) => {
  try {
    const scope = userScope(req);
    const userIdClause = scope.sql;
    const userIdParams = scope.params;

    // Récupérer les stats par heure
    const [trends] = await pool.execute(
      `SELECT 
        HOUR(${OPERATIONAL_TS}) as hour,
        COUNT(*) as total,
        SUM(CASE WHEN log_level IN ('ERROR','CRITICAL','FATAL') THEN 1 ELSE 0 END) as errors,
        SUM(CASE WHEN log_level = 'CRITICAL' THEN 1 ELSE 0 END) as critical,
        SUM(CASE WHEN log_level = 'FATAL' THEN 1 ELSE 0 END) as fatal
       FROM logs
       WHERE ${OPERATIONAL_TS} >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
       ${userIdClause}
       GROUP BY HOUR(${OPERATIONAL_TS})
       ORDER BY hour ASC`,
      userIdParams
    );

    res.json({ trends });
  } catch (e) {
    logger.error({ event: 'trending_error', error: e.message }, '[LOGS]');
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * GET /api/logs/level-distribution
 * Répartition par niveau de log - FIX pour watchlog
 */
router.get('/level-distribution', async (req, res) => {
  try {
    const scope = userScope(req);
    const userIdClause = scope.sql;
    const userIdParams = scope.params;

    const [distribution] = await pool.execute(
      `SELECT 
        log_level as level,
        COUNT(*) as count,
        ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM logs WHERE ${OPERATIONAL_TS} >= DATE_SUB(NOW(), INTERVAL 24 HOUR) ${userIdClause}), 2) as percentage
       FROM logs
       WHERE ${OPERATIONAL_TS} >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
       ${userIdClause}
       GROUP BY log_level
       ORDER BY FIELD(log_level, 'FATAL', 'CRITICAL', 'ERROR', 'WARNING', 'INFO', 'DEBUG')`,
      [...userIdParams, ...userIdParams]
    );

    res.json({ distribution });
  } catch (e) {
    logger.error({ event: 'distribution_error', error: e.message }, '[LOGS]');
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * GET /api/logs/imported-today
 * Logs importés aujourd'hui (pour watchlog)
 */
router.get('/imported-today', async (req, res) => {
  try {
    const scope = userScope(req);
    const today = new Date().toISOString().slice(0, 10);
    const limit = Math.min(parseInt(req.query.limit || 100), 500);
    
    const [rows] = await pool.execute(
      `SELECT 
        id,
        timestamp,
        log_level,
        message,
        source_server,
        source,
        service,
        imported_at,
        import_job_id
       FROM logs
       WHERE imported_at >= ? AND imported_at < ?${scope.sql}
       ORDER BY imported_at DESC
       LIMIT ?`,
      [today + ' 00:00:00', today + ' 23:59:59', ...scope.params, limit]
    );
    
    res.json({ imported_logs: rows });
  } catch (e) {
    logger.error({ event: 'imported_today_error', error: e.message }, '[IMPORT]');
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * GET /api/logs/import-jobs/:jobId/live
 * Suivi en temps réel d'un job d'import (pour watchlog)
 */
router.get('/import-jobs/:jobId/live', async (req, res) => {
  try {
    const scope = userScope(req);
    const jobId = req.params.jobId;

    // Vérifier que le job appartient à l'utilisateur
    const [job] = await pool.execute(
      `SELECT 
        id, filename, status, total_lines, processed_lines,
        error_count, created_at, completed_at, import_summary
       FROM import_jobs
       WHERE id = ? AND user_id = ?`,
      [jobId, req.session.user.id]
    );

    if (job.length === 0) {
      return res.status(404).json({ error: 'Job non trouvé' });
    }

    const jobData = job[0];
    const total = jobData.total_lines || 0;
    const processed = jobData.processed_lines || 0;
    const errors = jobData.error_count || 0;

    // Logs importés par ce job
    const [logs] = await pool.execute(
      `SELECT 
        id, timestamp, log_level, message, service,
        source_server
       FROM logs
       WHERE import_job_id = ?
       ORDER BY timestamp DESC
       LIMIT 100`,
      [jobId]
    );

    res.json({
      job: {
        id: jobData.id,
        filename: jobData.filename,
        status: jobData.status,
        progress: total > 0 ? Math.round((processed / total) * 100) : 0,
        total_lines: total,
        processed_lines: processed,
        error_count: errors,
        created_at: jobData.created_at,
        completed_at: jobData.completed_at,
        summary: jobData.import_summary ? JSON.parse(jobData.import_summary) : null
      },
      recent_logs: logs
    });
  } catch (e) {
    logger.error({ event: 'import_job_live_error', error: e.message }, '[IMPORT]');
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * GET /api/logs/recent-imports
 * Imports récents pour affichage dans watchlog
 */
router.get('/recent-imports', async (req, res) => {
  try {
    const scope = userScope(req);
    const limit = Math.min(parseInt(req.query.limit || 20), 100);

    const [imports] = await pool.execute(
      `SELECT 
        id, filename, status, total_lines, processed_lines,
        error_count, created_at, completed_at
       FROM import_jobs
       WHERE user_id = ?${scope.sql}
       ORDER BY created_at DESC
       LIMIT ?`,
      [req.session.user.id, ...scope.params, limit]
    );

    res.json({ imports });
  } catch (e) {
    logger.error({ event: 'recent_imports_error', error: e.message }, '[IMPORT]');
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
