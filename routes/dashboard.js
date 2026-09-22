import { Router } from 'express';
import logger from '../config/logger.js';
import pool from '../config/database.js';
import { userScope, requireAuth, requireAdmin } from '../middleware/auth.js';
import { getCachedDashboard, setCachedDashboard, invalidateDashboard } from '../services/cacheService.js';
import { getWatcherStatus } from '../services/watcherService.js';
import { getRedisClient } from '../services/cacheService.js';
import {
  OPERATIONAL_TS,
  OPERATIONAL_TS_EXPR,
  toMysqlUtcDatetime,
  utcBoundsForCalendarDate,
  utcTodayBounds,
} from '../lib/operationalTime.js';
import alertWorker from '../workers/alertWorker.js';

// Helper function to safely parse integers from query parameters
function asInt(v, def = 10) {
  const n = parseInt(v, 10);
  return isNaN(n) ? def : n;
}

const router = Router();

router.use(requireAuth);

function alertScope(req) {
  const user = req.session?.user;
  if (!user) {
    return { sql: ' AND 1=0', params: [] };
  }
  return { sql: ' AND user_id = ?', params: [parseInt(user.id, 10)] };
}


// PUT /alerts/read-all — MUST be first (static route)
router.put('/alerts/read-all', async (req, res) => {
  try {
    const scope = alertScope(req);
    const currentUserId = req.session.user.id;
    await pool.execute(
      "UPDATE alerts SET status = 'read', read_at = NOW() WHERE status = 'new'" + scope.sql,
      [...scope.params]
    );
    await invalidateDashboard(currentUserId);
    res.json({ success: true });
  } catch (e) {
    logger.error({ event: 'alert_read_all_failed', error: e.message }, '[DASHBOARD]');
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /alerts/:id/read
router.put('/alerts/:id/read', async (req, res) => {
  try {
    const scope = alertScope(req);
    let sql = 'UPDATE alerts SET status = \'read\', read_at = NOW() WHERE id = ?';
    const params = [req.params.id];
    if (scope.sql) {
      sql += scope.sql;
      params.push(...scope.params);
    }
    const [result] = await pool.execute(sql, params);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Alerte introuvable' });
    }
    await invalidateDashboard(req.session.user.id);
    res.json({ success: true });
  } catch (e) {
    logger.error({ event: 'alert_read_failed', error: e.message }, '[DASHBOARD]');
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * Alias POST pour la compatibilité frontend (Bug 7)
 * Le frontend appelle /api/alerts/read-all en POST mais la route originale est PUT
 */
router.post('/alerts/read-all', async (req, res) => {
  try {
    const scope = alertScope(req);
    await pool.execute(
      "UPDATE alerts SET status = 'read', read_at = NOW() WHERE status = 'new'" + scope.sql,
      [...scope.params]
    );
    await invalidateDashboard(req.session.user.id);
    res.json({ success: true });
  } catch (e) {
    logger.error({ event: 'alert_read_all_alias_failed', error: e.message }, '[DASHBOARD]');
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /summary
router.get('/summary', async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    
    // P-09: Try to get from cache first
    const cached = await getCachedDashboard(userId);
    if (cached) {
      return res.json(cached);
    }
    
    const scope = userScope(req);
    
    try {
      var [total] = await pool.execute('SELECT COUNT(*) as cnt FROM logs WHERE 1=1' + scope.sql, [...scope.params]);
    } catch (dbErr) {
      logger.error({ event: 'dashboard_summary_db_error', step: 'total_count', error: dbErr.message }, '[DASHBOARD]');
      return res.status(503).json({ error: 'Base de données indisponible', code: 'DB_UNAVAILABLE' });
    }
    
    /**
     * todayCount: logs whose event occurred today (event_timestamp).
     * importedTodayCount: logs imported today (ingestion activity).
     */
    const { start: todayStartSql } = utcTodayBounds();
    var [importedToday] = await pool.execute(
      `SELECT COUNT(*) as cnt FROM logs WHERE ${OPERATIONAL_TS} >= ?` + scope.sql,
      [todayStartSql, ...scope.params]
    );
    var [errorCount] = await pool.execute(
      `SELECT COUNT(*) as cnt FROM logs WHERE ${OPERATIONAL_TS} >= ? AND log_level IN ('ERROR', 'CRITICAL', 'FATAL')` + scope.sql,
      [todayStartSql, ...scope.params]
    );
    const alertFilter = alertScope(req);
    var [unreadAlerts] = await pool.execute(
      "SELECT COUNT(*) as cnt FROM alerts WHERE status = 'new'" + alertFilter.sql,
      alertFilter.params
    );
    var [fatalCount] = await pool.execute(
      "SELECT COUNT(*) as cnt FROM logs WHERE log_level = 'FATAL'" + scope.sql,
      scope.params
    );
    var [criticalCount] = await pool.execute(
      "SELECT COUNT(*) as cnt FROM logs WHERE log_level = 'CRITICAL'" + scope.sql,
      scope.params
    );
    var [sourceCount] = await pool.execute(
      'SELECT COUNT(DISTINCT source) as cnt FROM logs WHERE source IS NOT NULL AND source != \'\'' + scope.sql,
      scope.params
    );
    
    // Log size control - Calculate total log size
    var [logSizeStats] = await pool.execute(
      `SELECT 
        COUNT(*) as total_logs,
        SUM(LENGTH(raw_log)) as total_bytes,
        AVG(LENGTH(raw_log)) as avg_bytes_per_log
       FROM logs WHERE 1=1` + scope.sql,
      scope.params
    );
    
    const totalBytes = logSizeStats[0]?.total_bytes || 0;
    const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
    const avgBytes = logSizeStats[0]?.avg_bytes_per_log || 0;
    
    var [levelRows] = await pool.execute(
      'SELECT log_level, COUNT(*) as cnt FROM logs WHERE log_level IS NOT NULL' + scope.sql + ' GROUP BY log_level',
      scope.params
    );

    // Compter les utilisateurs
    var [userCount] = await pool.execute('SELECT COUNT(*) as cnt FROM users WHERE is_active = 1');

    // Niveaux par clé
    const levels = {};
    for (const row of levelRows) {
      levels[String(row.log_level || '').toUpperCase()] = Number(row.cnt);
    }

    const data = {
      // Standardized camelCase format
      totalLogs: Number(total[0].cnt),
      todayLogs: Number(importedToday[0].cnt),
      importedTodayCount: Number(importedToday[0].cnt),
      errorCount: Number(errorCount[0].cnt),
      unreadAlerts: Number(unreadAlerts[0].cnt),
      fatalCount: Number(fatalCount[0].cnt),
      criticalCount: Number(criticalCount[0].cnt),
      infoCount: Number(levels['INFO'] || 0),
      warningCount: Number(levels['WARNING'] || 0),
      userCount: Number(userCount[0].cnt),
      sourceCount: Number(sourceCount[0].cnt),
      // Log size control
      totalLogSizeMB: totalMB,
      totalLogSizeBytes: totalBytes,
      avgLogSizeBytes: avgBytes,
      // Levels breakdown
      levels: levels,
      levelDebug: Number(levels['DEBUG'] || 0),
      levelInfo: Number(levels['INFO'] || 0),
      levelWarning: Number(levels['WARNING'] || 0),
      levelError: Number(levels['ERROR'] || 0),
      levelCritical: Number(levels['CRITICAL'] || 0),
      levelFatal: Number(levels['FATAL'] || 0),
      // snake_case for frontend compatibility
      total_logs: Number(total[0].cnt),
      today_logs: Number(importedToday[0].cnt),
      imported_today_count: Number(importedToday[0].cnt),
      error_count: Number(errorCount[0].cnt),
      unread_alerts: Number(unreadAlerts[0].cnt),
      fatal_count: Number(fatalCount[0].cnt),
      critical_count: Number(criticalCount[0].cnt),
      total_log_size_mb: totalMB,
      total_log_size_bytes: totalBytes,
      avg_log_size_bytes: avgBytes,
      levels_breakdown: levels,
    };

    // P-09: Cache the result with 30s TTL
    await setCachedDashboard(userId, data);
    res.json(data);
  } catch (e) {
    logger.error({ event: 'dashboard_summary_error', error: e.message, stack: e.stack }, '[DASHBOARD]');
    if (!res.headersSent) {
      const statusCode = e.code === 'PROTOCOL_CONNECTION_LOST' ? 503 : 500;
      res.status(statusCode).json({ 
        error: statusCode === 503 ? 'Base de données indisponible' : 'Erreur serveur',
        code: statusCode === 503 ? 'DB_CONNECTION_LOST' : 'SUMMARY_ERROR'
      });
    }
  }
});

// GET /trends — par jour sur N jours
// API tendances avec support pour dates de début/fin et périodes historiques
router.get('/trends', async (req, res) => {
  try {
    let startDate, endDate, days;
    
    const startParam = req.query.start_date || req.query.date_from;
    const endParam = req.query.end_date || req.query.date_to; // No asInt needed here, it's a date string

    let startSql;
    let endSql;

    // Priorité 1: dates explicites (calendrier UTC — aligné sur fmtDate frontend)
    if (startParam && endParam) {
      const startBounds = utcBoundsForCalendarDate(startParam);
      const endBounds = utcBoundsForCalendarDate(endParam);
      startSql = startBounds.start;
      endSql = endBounds.end;
      startDate = new Date(startParam.slice(0, 10) + 'T00:00:00.000Z');
      endDate = new Date(endParam.slice(0, 10) + 'T23:59:59.000Z');
      days = parseInt(req.query.days) || 7;

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.status(400).json({ error: 'Dates invalides' });
      }
      if (startDate > endDate) {
        return res.status(400).json({ error: 'La date de début doit être antérieure à la date de fin' });
      }
    }
    // Priorité 2: nombre de jours (fenêtre glissante UTC)
    else {
      days = parseInt(req.query.days || req.query.hours || '7', 10);
      const now = new Date();
      endDate = new Date(now);
      endSql = toMysqlUtcDatetime(endDate);
      startDate = new Date(now.getTime() - (days - 1) * 86400000);
      startDate.setUTCHours(0, 0, 0, 0);
      endDate.setUTCHours(23, 59, 59, 999);
      startSql = toMysqlUtcDatetime(startDate);
      endSql = toMysqlUtcDatetime(endDate);
    }

    // Génération des jours pour la période
    if (req.query.interval === 'hour') {
      const labels = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0') + ':00');
      const levels = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL', 'FATAL'];
      const seriesData = {};
      levels.forEach(l => { seriesData[l] = new Array(24).fill(0); });
      const scope = userScope(req);
      const [rows] = await pool.execute(
        `SELECT HOUR(${OPERATIONAL_TS}) AS hour, UPPER(log_level) AS log_level, COUNT(*) AS cnt
         FROM logs
         WHERE ${OPERATIONAL_TS} IS NOT NULL AND ${OPERATIONAL_TS} >= ? AND ${OPERATIONAL_TS} <= ?${scope.sql}
         GROUP BY HOUR(${OPERATIONAL_TS}), UPPER(log_level)
         ORDER BY hour ASC`,
        [startSql, endSql, ...scope.params]
      );
      for (const row of rows) {
        const idx = Number(row.hour);
        const levelKey = String(row.log_level || '').toUpperCase();
        if (idx >= 0 && idx < 24 && seriesData[levelKey] !== undefined) {
          seriesData[levelKey][idx] = Number(row.cnt);
        }
      }
      const dailyTotal = labels.map((_, i) => levels.reduce((sum, level) => sum + seriesData[level][i], 0));
      return res.json({
        dates: labels, 
        labels: labels, 
        series: seriesData,
        info: seriesData.INFO, 
        warning: seriesData.WARNING, 
        error: seriesData.ERROR,
        critical: seriesData.CRITICAL, 
        fatal: seriesData.FATAL, 
        debug: seriesData.DEBUG,
        dailyTotal: dailyTotal, 
        days: 1, 
        interval: 'hour',
        // snake_case for frontend compatibility
        daily_total: dailyTotal
      });
    }

    const dates = [];
    const current = new Date(startDate);
    while (current <= endDate) {
      dates.push(current.toISOString().slice(0, 10));
      current.setUTCDate(current.getUTCDate() + 1);
    }

    const levels = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL', 'FATAL'];
    const seriesData = {};
    levels.forEach(l => { seriesData[l] = new Array(dates.length).fill(0); });

    // Requête optimisée avec dates de début/fin explicites
    // Use imported_at to show import trends
    const scope = userScope(req);
    const [rows] = await pool.execute(
      `SELECT DATE_FORMAT(${OPERATIONAL_TS}, '%Y-%m-%d') AS day,
              UPPER(log_level) AS log_level,
              COUNT(*) AS cnt
       FROM logs
       WHERE ${OPERATIONAL_TS} IS NOT NULL 
         AND ${OPERATIONAL_TS} >= ? 
         AND ${OPERATIONAL_TS} <= ?${scope.sql}
       GROUP BY DATE_FORMAT(${OPERATIONAL_TS}, '%Y-%m-%d'), UPPER(log_level)
       ORDER BY day ASC`,
      [startSql, endSql, ...scope.params]
    );

    // Remplissage : chaque ligne de résultat → bon index dans le tableau
    for (const row of rows) {
      const idx = dates.indexOf(row.day);
      const levelKey = String(row.log_level || '').toUpperCase();
      if (idx >= 0 && seriesData[levelKey] !== undefined) {
        seriesData[levelKey][idx] = Number(row.cnt);
      }
    }

    // Total par jour (toutes niveaux confondus) — utile pour le frontend
    // Utiliser dates.length au lieu de days pour correspondre exactement aux dates retournées
    const dailyTotal = new Array(dates.length).fill(0);
    for (let i = 0; i < dates.length; i++) {
      levels.forEach(l => { dailyTotal[i] += seriesData[l][i]; });
    }

    // Ensure we always return arrays, even if empty
    const safeDailyTotal = dailyTotal.length > 0 ? dailyTotal : [];
    const safeDates = dates.length > 0 ? dates : [];
    const safeSeriesData = {};
    levels.forEach(l => { 
      safeSeriesData[l] = seriesData[l]?.length > 0 ? seriesData[l] : [];
    });

    // Stats globales sur la période (avec vraies dates)
    const [stats] = await pool.execute(
      `SELECT COUNT(*) as total_logs,
              COUNT(DISTINCT service) as unique_services,
              COUNT(DISTINCT source) as unique_sources
       FROM logs
       WHERE ${OPERATIONAL_TS} IS NOT NULL 
         AND ${OPERATIONAL_TS} >= ? 
         AND ${OPERATIONAL_TS} <= ?${scope.sql}`,
      [startSql, endSql, ...scope.params]
    );

    let topFingerprints = [];
    try {
      [topFingerprints] = await pool.execute(
        `SELECT fingerprint, COUNT(*) as cnt
         FROM logs
         WHERE ${OPERATIONAL_TS} IS NOT NULL 
           AND ${OPERATIONAL_TS} >= ? 
           AND ${OPERATIONAL_TS} <= ? 
           AND fingerprint IS NOT NULL${scope.sql}
         GROUP BY fingerprint
         ORDER BY cnt DESC
         LIMIT 5`,
        [startSql, endSql, ...scope.params]
      );
    } catch (fpErr) {
      logger.warn({ event: 'dashboard_trends_fingerprints_skipped', error: fpErr.message }, '[DASHBOARD]');
    }

    // Format with consistent camelCase and safe arrays
    const trendsArray = safeDates.map((date, i) => ({
      date,
      count: safeDailyTotal[i] || 0,
      errorCount: (safeSeriesData['ERROR']?.[i] || 0) + (safeSeriesData['CRITICAL']?.[i] || 0) + (safeSeriesData['FATAL']?.[i] || 0),
    }));

    res.json({
      trends: trendsArray,
      dates: safeDates,
      labels: safeDates,
      series: safeSeriesData,
      info: safeSeriesData.INFO,
      warning: safeSeriesData.WARNING,
      error: safeSeriesData.ERROR,
      critical: safeSeriesData.CRITICAL,
      fatal: safeSeriesData.FATAL,
      debug: safeSeriesData.DEBUG,
      dailyTotal: safeDailyTotal,
      days: safeDates.length,
      stats: {
        totalLogs: stats[0]?.total_logs || 0,
        uniqueServices: stats[0]?.unique_services || 0,
        uniqueSources: stats[0]?.unique_sources || 0
      },
      topFingerprints: topFingerprints,
      // snake_case for frontend compatibility
      daily_total: safeDailyTotal,
      total_logs: stats[0]?.total_logs || 0,
      unique_services: stats[0]?.unique_services || 0,
      unique_sources: stats[0]?.unique_sources || 0,
      top_fingerprints: topFingerprints
    });
  } catch (e) {
    logger.error({ event: 'dashboard_trends_error', error: e.message, stack: e.stack }, '[DASHBOARD]');
    if (!res.headersSent) {
      const statusCode = e.code === 'PROTOCOL_CONNECTION_LOST' ? 503 : 500;
      res.status(statusCode).json({ 
        error: statusCode === 503 ? 'Base de données indisponible' : 'Erreur serveur',
        code: statusCode === 503 ? 'DB_CONNECTION_LOST' : 'TRENDS_ERROR'
      });
    }
  }
});

// GET /top-errors
router.get('/top-errors', async (req, res) => {
  try {
    const scope = userScope(req);
    const limit = asInt(req.query.limit, 10);
    const [rows] = await pool.query(
      `SELECT id, fingerprint, title, event_type, error_type, severity_max, occurrence_count,
              first_seen, previous_seen, last_seen, returned_at, return_reason, return_count,
              source_server, service, status, sample_log_id, user_id
       FROM error_groups
       WHERE status IN ('open','returned')${scope.sql}
       ORDER BY (status = 'returned') DESC, occurrence_count DESC
       LIMIT ?`,
      [...scope.params, limit]
    );
    
    // Fetch sample logs for each error group to show details
    const errorGroupIds = rows.map(r => r.id);
    const sampleLogsMap = new Map();
    
    if (errorGroupIds.length > 0) {
      const placeholders = errorGroupIds.map(() => '?').join(',');
      const [sampleLogs] = await pool.query(
        `SELECT id, fingerprint, timestamp, log_level, message, source, service, error_type,
                stack_trace, target_user, module, event_type
         FROM logs
         WHERE fingerprint IN (
           SELECT fingerprint FROM error_groups WHERE id IN (${placeholders})
         )${scope.sql}
         ORDER BY timestamp DESC 
         LIMIT 50`,
        [...errorGroupIds, ...scope.params]
      );
      
      // Group sample logs by fingerprint
      for (const log of sampleLogs) {
        if (!sampleLogsMap.has(log.fingerprint)) {
          sampleLogsMap.set(log.fingerprint, []);
        }
        sampleLogsMap.get(log.fingerprint).push(log);
      }
    }
    
    // Format with consistent camelCase
    const normalized = rows.map(r => {
      const samples = sampleLogsMap.get(r.fingerprint) || [];
      return {
        ...r,
        count: r.occurrence_count,
        message: r.title || r.event_type,
        source: r.source_server,
        lastSeen: r.last_seen,
        sampleLogId: r.sample_log_id || (samples[0] && samples[0].id) || null,
        sampleLogs: samples,
        // Add snake_case for compatibility
        sample_log_id: r.sample_log_id || (samples[0] && samples[0].id) || null,
        occurrence_count: r.occurrence_count,
        source_server: r.source_server,
        first_seen: r.first_seen,
        last_seen: r.last_seen
      };
    });
    // Return both formats for compatibility
    res.json({ topErrors: normalized, errors: normalized });
  } catch (e) {
    logger.error({ event: 'dashboard_top_errors_error', error: e.message, stack: e.stack }, '[DASHBOARD]');
    if (!res.headersSent) {
      const statusCode = e.code === 'PROTOCOL_CONNECTION_LOST' ? 503 : 500;
      res.status(statusCode).json({ 
        error: statusCode === 503 ? 'Base de données indisponible' : 'Erreur serveur',
        code: statusCode === 503 ? 'DB_CONNECTION_LOST' : 'TOP_ERRORS_ERROR',
        topErrors: [],
        errors: []
      });
    }
  }
});

// GET /recent-logs
router.get('/recent-logs', async (req, res) => {
  try {
    const scope = userScope(req);
    const limit = asInt(req.query.limit, 10);
    // Build filter conditions
    let filterSql = '';
    let filterParams = [];
    
    if (req.query.level) {
      filterSql += ' AND log_level = ?';
      filterParams.push(req.query.level);
    }
    
    if (req.query.source) {
      filterSql += ' AND source = ?';
      filterParams.push(req.query.source);
    }
    
    if (req.query.platform) {
      filterSql += ' AND source_system = ?';
      filterParams.push(req.query.platform);
    }
    
    if (req.query.sourceType) {
      filterSql += ' AND source_type = ?';
      filterParams.push(req.query.sourceType);
    }
    
    if (req.query.directory) {
      filterSql += ' AND source LIKE ?';
      filterParams.push(req.query.directory + '%');
    }
    
    if (req.query.service) {
      filterSql += ' AND service = ?';
      filterParams.push(req.query.service);
    }
    
    if (req.query.timeRange) {
      const timeBounds = getTimeBounds(req.query.timeRange);
      if (timeBounds) {
        filterSql += ' AND timestamp >= ? AND timestamp <= ?';
        filterParams.push(timeBounds.start, timeBounds.end);
      }
    }
    
    if (req.query.search) {
      filterSql += ' AND message LIKE ?';
      filterParams.push(`%${req.query.search}%`);
    }
    
    const [rows] = await pool.query(
      `SELECT id, raw_log, timestamp, log_level, message, source, source_server, source_system,
              service, target_user, imported_at, imported_by_user_id
       FROM logs WHERE 1=1${scope.sql}${filterSql}
       ORDER BY ${OPERATIONAL_TS_EXPR} DESC LIMIT ?`,
      [...scope.params, ...filterParams, limit]
    );
    // Normalize fields to consistent camelCase
    const normalized = rows.map(r => ({
      ...r,
      logLevel: r.log_level || r.logLevel,
      importedAt: r.imported_at || r.importedAt,
      importedByUserId: r.imported_by_user_id || r.imported_by_user_id,
      createdAt: r.created_at || r.createdAt,
    }));
    // Return both formats for compatibility
    res.json({ recentLogs: normalized, logs: normalized });
  } catch (e) {
    logger.error({ event: 'recent_logs_error', error: e.message }, '[DASHBOARD]');
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur', details: e.message });
  }
});

// Helper function to get time bounds for filter
function getTimeBounds(range) {
  const now = new Date();
  switch (range) {
    case '1h':
      return { start: new Date(now - 60 * 60 * 1000), end: now };
    case '24h':
      return { start: new Date(now - 24 * 60 * 60 * 1000), end: now };
    case '7d':
      return { start: new Date(now - 7 * 24 * 60 * 60 * 1000), end: now };
    case '30d':
      return { start: new Date(now - 30 * 24 * 60 * 60 * 1000), end: now };
    default:
      return null;
  }
}

// GET /alerts
router.get('/alerts', async (req, res) => {
  try {
    const scope = alertScope(req);
    const limit = asInt(req.query.limit, 20);
    let sql = 'SELECT * FROM alerts WHERE 1=1' + scope.sql;
    const params = [...scope.params];
    if (req.query.status) {
      sql += ' AND status = ?';
      params.push(req.query.status);
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    const [rows] = await pool.query(sql, params);
    
    // Add snake_case fields for compatibility
    const normalized = rows.map(r => ({
      ...r,
      alert_type: r.alert_type,
      created_at: r.created_at,
      read_at: r.read_at,
      occurrence_count: r.occurrence_count
    }));
    
    res.json(normalized);
  } catch (e) {
    logger.error({ event: 'alerts_error', error: e.message, sql: e.sql }, '[DASHBOARD ALERTS]');
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur', details: e.message });
  }
});

// GET /alerts/critical-only - Week 3: Alertes Automatisées
router.get('/alerts/critical-only', async (req, res) => {
  try {
    const userId = req.session.user.id;
    
    // Retourner SEULEMENT les alertes critiques non lues
    const [alerts] = await pool.execute(
      `SELECT * FROM alerts
       WHERE user_id = ?
       AND severity = 'critical'
       AND status = 'new'
       ORDER BY created_at DESC
       LIMIT 10`,
      [userId]
    );

    res.json({ alerts });
  } catch (e) {
    logger.error({ event: 'critical_alerts_error', error: e.message }, '[DASHBOARD]');
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /alerts/grouped - Week 3: Alertes Automatisées
router.get('/alerts/grouped', async (req, res) => {
  try {
    const userId = req.session.user.id;
    
    const [grouped] = await pool.execute(
      `SELECT 
        alert_type,
        severity,
        COUNT(*) as count,
        MAX(created_at) as latest,
        MIN(created_at) as earliest
       FROM alerts
       WHERE user_id = ?
       AND status = 'new'
       GROUP BY alert_type, severity
       ORDER BY count DESC`,
      [userId]
    );

    res.json({ 
      summary: grouped,
      message: `${grouped.reduce((sum, g) => sum + g.count, 0)} new alerts` 
    });
  } catch (e) {
    logger.error({ event: 'grouped_alerts_error', error: e.message }, '[DASHBOARD]');
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /alerts/system-only - Filtre pour grouper les alertes qui affectent directement le système
router.get('/alerts/system-only', async (req, res) => {
  try {
    const userId = req.session.user.id;
    
    // Retourner SEULEMENT les alertes qui affectent le système (CRITICAL, FATAL, et alertes d'infrastructure)
    const [alerts] = await pool.execute(
      `SELECT * FROM alerts
       WHERE user_id = ?
       AND severity IN ('critical', 'fatal')
       AND (alert_type LIKE '%system%' OR alert_type LIKE '%infrastructure%' OR alert_type LIKE '%database%')
       AND status = 'new'
       ORDER BY created_at DESC
       LIMIT 15`,
      [userId]
    );

    res.json({ alerts });
  } catch (e) {
    logger.error({ event: 'system_alerts_error', error: e.message }, '[DASHBOARD]');
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /alerts/:id/retry - Week 3: Alertes Automatisées
router.post('/alerts/:id/retry', async (req, res) => {
  try {
    const alertId = parseInt(req.params.id);
    const userId = req.session.user.id;

    const [alert] = await pool.execute(
      `SELECT * FROM alerts WHERE id = ? AND user_id = ?`,
      [alertId, userId]
    );

    if (!alert.length) {
      return res.status(404).json({ error: 'Alerte non trouvée' });
    }

    // Marquer comme NEW et relancer
    await pool.execute(
      `UPDATE alerts SET status = 'new', created_at = NOW() WHERE id = ?`,
      [alertId]
    );

    // Notifier via SSE
    alertWorker.broadcast('alert_retry', { alertId });

    res.json({ success: true, message: 'Alerte renvoyée' });
  } catch (e) {
    logger.error({ event: 'alert_retry_error', error: e.message }, '[DASHBOARD]');
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /per-level
router.get('/per-level', async (req, res) => {
  try {
    const scope = userScope(req);
    const [rows] = await pool.execute(
      'SELECT log_level, COUNT(*) as cnt FROM logs WHERE log_level IS NOT NULL' + scope.sql + ' GROUP BY log_level',
      [...scope.params]
    );
    const result = {};
    const allLevels = ['TRACE', 'DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL', 'FATAL'];
    // Initialize all levels to 0
    allLevels.forEach(l => result[l] = 0);
    // Fill in actual counts
    for (const r of rows) {
      const level = String(r.log_level || '').toUpperCase();
      if (Object.prototype.hasOwnProperty.call(result, level)) {
        result[level] = r.cnt;
      }
    }
    res.json(result);
  } catch (e) {
    logger.error({ event: 'dashboard_level_distribution_error', error: e.message }, '[DASHBOARD]');
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /hourly
router.get('/hourly', async (req, res) => {
  try {
    const scope = userScope(req);
    const [rows] = await pool.execute(
      `SELECT HOUR(imported_at) as hour, COUNT(*) as cnt
       FROM logs
       WHERE imported_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)${scope.sql}
       GROUP BY hour
       ORDER BY hour`,
      scope.params
    );
    res.json(rows);
  } catch (e) {
    logger.error({ event: 'dashboard_hourly_activity_error', error: e.message }, '[DASHBOARD]');
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /today — synthèse du jour (logs, erreurs, activité, anomalies, modules, alertes)
router.get('/today', async (req, res) => {
  try {
    const scope = userScope(req);
    const alertFilter = alertScope(req);
    const { start: startSql, end: endSql } = utcTodayBounds();
    const start = new Date(startSql.replace(' ', 'T') + 'Z');

    const [todayStats] = await pool.execute(
      `SELECT COUNT(*) as total_logs,
              SUM(CASE WHEN log_level IN ('ERROR', 'CRITICAL', 'FATAL') THEN 1 ELSE 0 END) as error_count,
              COUNT(DISTINCT user_id) as active_users
       FROM logs
       WHERE ${OPERATIONAL_TS} >= ? AND ${OPERATIONAL_TS} <= ?${scope.sql}`,
      [startSql, endSql, ...scope.params]
    );

    const [activityPeaks] = await pool.execute(
      `SELECT HOUR(imported_at) as hour, COUNT(*) as cnt
       FROM logs
       WHERE imported_at >= ? AND imported_at <= ?${scope.sql}
       GROUP BY hour
       ORDER BY cnt DESC
       LIMIT 5`,
      [startSql, endSql, ...scope.params]
    );

    const [moduleRows] = await pool.execute(
      `SELECT COALESCE(module, source, 'unknown') as module, COUNT(*) as cnt
       FROM logs
       WHERE imported_at >= ? AND imported_at <= ?${scope.sql}
       GROUP BY COALESCE(module, source, 'unknown')
       ORDER BY cnt DESC
       LIMIT 10`,
      [startSql, endSql, ...scope.params]
    );

    const [anomalyRows] = await pool.execute(
      `SELECT fingerprint, COUNT(*) as cnt, MAX(${OPERATIONAL_TS_EXPR}) as last_seen, MAX(log_level) as severity_max
       FROM logs
       WHERE ${OPERATIONAL_TS} >= ? AND ${OPERATIONAL_TS} <= ? AND log_level IN ('ERROR', 'CRITICAL', 'FATAL')${scope.sql}
       GROUP BY fingerprint
       ORDER BY cnt DESC
       LIMIT 10`,
      [startSql, endSql, ...scope.params]
    );

    const [criticalAlerts] = await pool.execute(
      `SELECT COUNT(*) as critical_alerts
       FROM alerts
       WHERE created_at >= ? AND created_at <= ? AND severity IN ('high', 'critical')${alertFilter.sql}`,
      [startSql, endSql, ...alertFilter.params]
    );

    const [mainTrends] = await pool.execute(
      `SELECT log_level, COUNT(*) as cnt
       FROM logs
       WHERE imported_at >= ? AND imported_at <= ?${scope.sql}
       GROUP BY log_level
       ORDER BY cnt DESC`,
      [startSql, endSql, ...scope.params]
    );

    res.json({
      date: start.toISOString().slice(0, 10),
      logs_today: Number(todayStats[0].total_logs || 0),
      errors_today: Number(todayStats[0].error_count || 0),
      active_users: Number(todayStats[0].active_users || 0),
      activity_peaks: activityPeaks.map(row => ({ hour: Number(row.hour), count: Number(row.cnt) })),
      anomalies: anomalyRows.map(row => ({
        fingerprint: row.fingerprint,
        count: Number(row.cnt),
        last_seen: row.last_seen,
        severity: row.severity_max
      })),
      modules_most_used: moduleRows.map(row => ({ module: row.module, count: Number(row.cnt) })),
      critical_alerts: Number(criticalAlerts[0].critical_alerts || 0),
      main_trends: mainTrends.map(row => ({ level: row.log_level, count: Number(row.cnt) })),
      peak_hour: activityPeaks[0]?.hour ?? null
    });
  } catch (e) {
    logger.error({ event: 'dashboard_today_error', error: e.message }, '[DASHBOARD]');
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /system — état du système (db, redis, watcher) — [FIX-19] admin seulement
router.get('/system', requireAdmin, async (req, res) => {
  const status = { db: 'unknown', redis: 'unknown', watcher: {} };
  try {
    await pool.execute('SELECT 1');
    status.db = 'ok';
  } catch (e) {
    logger.warn({ event: 'dashboard_health_db_check_failed', error: e.message }, '[DASHBOARD]');
    status.db = 'error';
  }

  try {
    const r = getRedisClient();
    status.redis = r ? 'ok' : 'unavailable';
  } catch (e) {
    logger.warn({ event: 'dashboard_health_redis_check_failed', error: e.message }, '[DASHBOARD]');
    status.redis = 'error';
  }

  try {
    status.watcher = getWatcherStatus();
  } catch (e) { status.watcher = { running: false, error: e.message }; }

  // Format attendu par le frontend Next.js: { system: {...} }
  const [totalLogsRow] = await pool.execute('SELECT COUNT(*) as cnt FROM logs').catch(() => [[{cnt:0}]]);
  const [lastImportRow] = await pool.execute('SELECT MAX(created_at) as last FROM import_jobs').catch(() => [[{last:null}]]);
  const [activeUsersRow] = await pool.execute('SELECT COUNT(*) as cnt FROM users WHERE is_active = 1').catch(() => [[{cnt:0}]]);

  res.json({
    system: {
      ...status,
      uptime: process.uptime(),
      totalLogs: Number(totalLogsRow[0].cnt),
      dbSize: 'N/A',
      lastImport: lastImportRow[0].last,
      activeUsers: Number(activeUsersRow[0].cnt),
    },
    ...status
  });
});

// FIX BUG-ALERT-04: GET /alerts/:id - endpoint manquant (showAlertDetail l'utilise)
router.get('/alerts/:id', async (req, res) => {
  try {
    const scope = alertScope(req);
    const alertId = parseInt(req.params.id, 10);
    if (isNaN(alertId)) return res.status(400).json({ error: 'ID invalide' });
    const [rows] = await pool.execute(
      'SELECT * FROM alerts WHERE id = ?' + scope.sql,
      [alertId, ...scope.params]
    );
    if (!rows.length) return res.status(404).json({ error: 'Alerte introuvable' });
    res.json(rows[0]);
  } catch (e) {
    logger.error({ event: 'dashboard_alert_detail_error', error: e.message }, '[DASHBOARD]');
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
