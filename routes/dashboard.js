import { Router } from 'express';
import logger from '../config/logger.js';
import pool from '../config/database.js';
import { userScope, requireAuth } from '../middleware/auth.js';
import { getCachedDashboard, setCachedDashboard, invalidateDashboard } from '../services/cacheService.js';
import { getWatcherStatus } from '../services/watcherService.js';
import { getRedisClient } from '../services/cacheService.js';

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
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
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
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
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
    res.json({ success: true });
  } catch (e) {
    logger.error({ event: 'alert_read_all_alias_failed', error: e.message }, '[DASHBOARD]');
    res.status(500).json({ error: 'Erreur serveur' });
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
    const [total] = await pool.execute('SELECT COUNT(*) as cnt FROM logs WHERE 1=1' + scope.sql, [...scope.params]);
    
    /**
     * Note : todayCount est basé sur 'imported_at' pour refléter l'activité d'ingestion (Bug 5).
     * Pour les logs basés sur le temps événement, filtrer sur 'timestamp'.
     */
    const todayStr = new Date().toISOString().slice(0, 10);
    const [today] = await pool.execute(
      'SELECT COUNT(*) as cnt FROM logs WHERE imported_at >= ?' + scope.sql,
      [todayStr + ' 00:00:00', ...scope.params]
    );
    const [errorCount] = await pool.execute(
      "SELECT COUNT(*) as cnt FROM logs WHERE imported_at >= ? AND log_level IN ('ERROR', 'CRITICAL', 'FATAL')" + scope.sql,
      [todayStr + ' 00:00:00', ...scope.params]
    );
    const alertFilter = alertScope(req);
    const [unreadAlerts] = await pool.execute(
      "SELECT COUNT(*) as cnt FROM alerts WHERE status = 'new'" + alertFilter.sql,
      alertFilter.params
    );
    const [fatalCount] = await pool.execute(
      "SELECT COUNT(*) as cnt FROM logs WHERE log_level = 'FATAL'" + scope.sql,
      scope.params
    );
    const [criticalCount] = await pool.execute(
      "SELECT COUNT(*) as cnt FROM logs WHERE log_level = 'CRITICAL'" + scope.sql,
      scope.params
    );
    const [sourceCount] = await pool.execute(
      'SELECT COUNT(DISTINCT source) as cnt FROM logs WHERE source IS NOT NULL AND source != \'\'' + scope.sql,
      scope.params
    );
    const [levelRows] = await pool.execute(
      'SELECT log_level, COUNT(*) as cnt FROM logs WHERE 1=1' + scope.sql + ' GROUP BY log_level',
      scope.params
    );

    // Compter les utilisateurs
    const [userCount] = await pool.execute('SELECT COUNT(*) as cnt FROM users WHERE is_active = 1');

    // Niveaux par clé
    const levels = {};
    for (const row of levelRows) {
      levels[String(row.log_level || '').toUpperCase()] = Number(row.cnt);
    }

    const data = {
      // camelCase pour le frontend Next.js
      totalLogs: Number(total[0].cnt),
      todayCount: Number(today[0].cnt),
      todayLogs: Number(today[0].cnt),
      errorCount: Number(errorCount[0].cnt),
      unreadAlerts: Number(unreadAlerts[0].cnt),
      fatalCount: Number(fatalCount[0].cnt),
      criticalCount: Number(criticalCount[0].cnt),
      infoCount: Number(levels['INFO'] || 0),
      warningCount: Number(levels['WARNING'] || 0),
      userCount: Number(userCount[0].cnt),
      sourceCount: Number(sourceCount[0].cnt),
      // snake_case pour compatibilité
      total_logs: Number(total[0].cnt),
      today_logs: Number(today[0].cnt),
      error_count: Number(errorCount[0].cnt),
      unread_alerts: Number(unreadAlerts[0].cnt),
      fatal_count: Number(fatalCount[0].cnt),
      critical_count: Number(criticalCount[0].cnt),
    };

    for (const row of levelRows) {
      const key = 'level_' + String(row.log_level || '').toLowerCase();
      data[key] = Number(row.cnt);
    }

    // P-09: Cache the result with 30s TTL
    await setCachedDashboard(userId, data);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /trends — par jour sur N jours
// API tendances avec support pour dates de début/fin et périodes historiques
router.get('/trends', async (req, res) => {
  try {
    let startDate, endDate, days;
    
    const startParam = req.query.start_date || req.query.date_from;
    const endParam = req.query.end_date || req.query.date_to; // No asInt needed here, it's a date string

    // Priorité 1: dates explicites (nouveau système + alias frontend)
    if (startParam && endParam) {
      startDate = new Date(startParam.includes('T') ? startParam : startParam + 'T00:00:00');
      endDate = new Date(endParam.includes('T') ? endParam : endParam + 'T23:59:59');
      days = parseInt(req.query.days) || 7;
      
      // Validation des dates
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.status(400).json({ error: 'Dates invalides' });
      }
      
      if (startDate >= endDate) {
        return res.status(400).json({ error: 'La date de début doit être antérieure à la date de fin' });
      }
    } 
    // Priorité 2: nombre de jours (compatibilité ancien système)
    else { // No asInt needed here, it's a date string
      days = parseInt(req.query.days || req.query.hours || '7', 10);
      const now = new Date();
      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - (days - 1));
      startDate.setHours(0, 0, 0, 0);
    }

    // Génération des jours pour la période
    if (req.query.interval === 'hour') {
      const labels = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0') + ':00');
      const levels = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL', 'FATAL'];
      const seriesData = {};
      levels.forEach(l => { seriesData[l] = new Array(24).fill(0); });
      const scope = userScope(req);
      const [rows] = await pool.execute(
        `SELECT HOUR(timestamp) AS hour, log_level, COUNT(*) AS cnt
         FROM logs
         WHERE timestamp >= ? AND timestamp <= ?${scope.sql}
         GROUP BY HOUR(timestamp), log_level
         ORDER BY hour ASC`,
        [startDate.toISOString().slice(0, 19).replace('T', ' '),
         endDate.toISOString().slice(0, 19).replace('T', ' '),
         ...scope.params]
      );
      for (const row of rows) {
        const idx = Number(row.hour);
        if (idx >= 0 && idx < 24 && seriesData[row.log_level] !== undefined) {
          seriesData[row.log_level][idx] = Number(row.cnt);
        }
      }
      const dailyTotal = labels.map((_, i) => levels.reduce((sum, level) => sum + seriesData[level][i], 0));
      return res.json({
        dates: labels, labels, series: seriesData,
        info: seriesData.INFO, warning: seriesData.WARNING, error: seriesData.ERROR,
        critical: seriesData.CRITICAL, fatal: seriesData.FATAL, debug: seriesData.DEBUG,
        daily_total: dailyTotal, days: 1, interval: 'hour'
      });
    }

    const dates = [];
    const current = new Date(startDate);
    while (current <= endDate) {
      dates.push(current.toISOString().slice(0, 10));
      current.setDate(current.getDate() + 1);
    }

    const levels = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL', 'FATAL'];
    const seriesData = {};
    levels.forEach(l => { seriesData[l] = new Array(dates.length).fill(0); });

    // Requête optimisée avec dates de début/fin explicites
    const scope = userScope(req);
    const [rows] = await pool.execute(
      `SELECT DATE_FORMAT(imported_at, '%Y-%m-%d') AS day,
              log_level,
              COUNT(*) AS cnt
       FROM logs
       WHERE imported_at >= ? AND imported_at <= ?${scope.sql}
       GROUP BY day, log_level
       ORDER BY day ASC`,
      [startDate.toISOString().slice(0, 19).replace('T', ' '), 
       endDate.toISOString().slice(0, 19).replace('T', ' '), 
       ...scope.params]
    );

    // Remplissage : chaque ligne de résultat → bon index dans le tableau
    for (const row of rows) {
      const idx = dates.indexOf(row.day);
      if (idx >= 0 && seriesData[row.log_level] !== undefined) {
        seriesData[row.log_level][idx] = Number(row.cnt);
      }
    }

    // Total par jour (toutes niveaux confondus) — utile pour le frontend
    // Utiliser dates.length au lieu de days pour correspondre exactement aux dates retournées
    const dailyTotal = new Array(dates.length).fill(0);
    for (let i = 0; i < dates.length; i++) {
      levels.forEach(l => { dailyTotal[i] += seriesData[l][i]; });
    }

    // Stats globales sur la période (avec vraies dates)
    const [stats] = await pool.execute(
      `SELECT COUNT(*) as total_logs,
              COUNT(DISTINCT service) as unique_services,
              COUNT(DISTINCT source) as unique_sources
       FROM logs
       WHERE imported_at >= ? AND imported_at <= ?${scope.sql}`,
      [startDate.toISOString().slice(0, 19).replace('T', ' '), 
       endDate.toISOString().slice(0, 19).replace('T', ' '), 
       ...scope.params]
    );

    const [topFingerprints] = await pool.execute(
      `SELECT fingerprint, COUNT(*) as cnt
       FROM logs
       WHERE timestamp >= ? AND timestamp <= ? AND fingerprint IS NOT NULL${scope.sql}
       GROUP BY fingerprint
       ORDER BY cnt DESC
       LIMIT 5`,
      [startDate.toISOString().slice(0, 19).replace('T', ' '), 
       endDate.toISOString().slice(0, 19).replace('T', ' '), 
       ...scope.params]
    );

    // Format attendu par le frontend Next.js
    const trendsArray = dates.map((date, i) => ({
      date,
      count: dailyTotal[i],
      errorCount: (seriesData['ERROR']?.[i] || 0) + (seriesData['CRITICAL']?.[i] || 0) + (seriesData['FATAL']?.[i] || 0),
    }));

    res.json({
      trends: trendsArray,
      dates,
      labels: dates,
      series: seriesData,
      info: seriesData.INFO,
      warning: seriesData.WARNING,
      error: seriesData.ERROR,
      critical: seriesData.CRITICAL,
      fatal: seriesData.FATAL,
      debug: seriesData.DEBUG,
      daily_total: dailyTotal,
      days: dates.length,
      stats: {
        total_logs: stats[0].total_logs,
        unique_services: stats[0].unique_services,
        unique_sources: stats[0].unique_sources
      },
      top_fingerprints: topFingerprints
    });
  } catch (e) {
    logger.error({ event: 'dashboard_trends_error', error: e.message }, '[DASHBOARD]');
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /top-errors
router.get('/top-errors', async (req, res) => {
  try {
    const scope = userScope(req);
    const limit = asInt(req.query.limit, 10);
    const [rows] = await pool.execute(
      `SELECT id, fingerprint, title, event_type, error_type, severity_max, occurrence_count,
              first_seen, previous_seen, last_seen, returned_at, return_reason, return_count,
              source_server, service, status, sample_log_id, user_id
       FROM error_groups
       WHERE status IN ('open','returned')${scope.sql}
       ORDER BY (status = 'returned') DESC, occurrence_count DESC
       LIMIT ?`,
      [...scope.params, limit]
    );
    // Format attendu par le frontend Next.js
    const normalized = rows.map(r => ({
      ...r,
      count: r.occurrence_count,
      message: r.title || r.event_type,
      source: r.source_server,
      lastSeen: r.last_seen,
    }));
    res.json({ topErrors: normalized, errors: normalized });
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /recent-logs
router.get('/recent-logs', async (req, res) => {
  try {
    const scope = userScope(req);
    const limit = asInt(req.query.limit, 10);
    const [rows] = await pool.execute(
      'SELECT * FROM logs WHERE 1=1' + scope.sql + ' ORDER BY id DESC LIMIT ?',
      [...scope.params, limit]
    );
    // Normaliser les champs pour le frontend Next.js (camelCase)
    const normalized = rows.map(r => ({
      ...r,
      logLevel: r.log_level || r.logLevel,
      importedAt: r.imported_at || r.importedAt,
      createdAt: r.created_at || r.createdAt,
      sourceDirectory: r.source_directory || r.sourceDirectory,
      fileName: r.file_name || r.fileName,
    }));
    // Retourner les deux formats pour compatibilité
    res.json({ recentLogs: normalized, logs: normalized });
  } catch (e) {
    logger.error({ event: 'recent_logs_error', error: e.message }, '[DASHBOARD]');
    res.status(500).json({ error: 'Erreur serveur', details: e.message });
  }
});

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
    const [rows] = await pool.execute(sql, params);
    res.json(rows);
  } catch (e) {
    logger.error({ event: 'alerts_error', error: e.message, sql: e.sql }, '[DASHBOARD ALERTS]');
    res.status(500).json({ error: 'Erreur serveur', details: e.message });
  }
});

// GET /per-level
router.get('/per-level', async (req, res) => {
  try {
    const scope = userScope(req);
    const [rows] = await pool.execute(
      'SELECT log_level, COUNT(*) as cnt FROM logs WHERE 1=1' + scope.sql + ' GROUP BY log_level',
      scope.params
    );
    const result = {};
    for (const r of rows) result[r.log_level] = r.cnt;
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
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
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /today — synthèse du jour (logs, erreurs, activité, anomalies, modules, alertes)
router.get('/today', async (req, res) => {
  try {
    const scope = userScope(req);
    const alertFilter = alertScope(req);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    const startSql = start.toISOString().slice(0, 19).replace('T', ' ');
    const endSql = end.toISOString().slice(0, 19).replace('T', ' ');

    const [todayStats] = await pool.execute(
      `SELECT COUNT(*) as total_logs,
              SUM(CASE WHEN log_level IN ('ERROR', 'CRITICAL', 'FATAL') THEN 1 ELSE 0 END) as error_count,
              COUNT(DISTINCT user_id) as active_users
       FROM logs
       WHERE imported_at >= ? AND imported_at <= ?${scope.sql}`,
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
      `SELECT fingerprint, COUNT(*) as cnt, MAX(timestamp) as last_seen, MAX(log_level) as severity_max
       FROM logs
       WHERE timestamp >= ? AND timestamp <= ? AND log_level IN ('ERROR', 'CRITICAL', 'FATAL')${scope.sql}
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
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /system — état du système (db, redis, watcher)
router.get('/system', async (req, res) => {
  const status = { db: 'unknown', redis: 'unknown', watcher: {} };
  try {
    await pool.execute('SELECT 1');
    status.db = 'ok';
  } catch (e) { status.db = 'error'; }

  try {
    const r = getRedisClient();
    status.redis = r ? 'ok' : 'unavailable';
  } catch (e) { status.redis = 'error'; }

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
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
