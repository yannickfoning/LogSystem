import chokidar from 'chokidar';
// V5: Use universal parser instead of parseTxt
import { parseLogContent, detectFormat } from '../lib/processing/universalParser.js';
import { normalizeMessage } from '../lib/processing/normalize.js';
import { classifyLog } from '../lib/processing/classify.js';
import { generateFingerprint } from '../lib/processing/fingerprint.js';
import logger from '../config/logger.js';
import { normalizeLevel } from '../config/database.js';
import pool from '../config/database.js';
import fs from 'fs';
import path from 'path';
import { alertEngineBus } from './alertEngine.js'; // FIX #5: Import du bus event-driven
import { alertWorker } from '../workers/alertWorker.js';

let watcher = null;
const fileOffsets = new Map(); // FIX #4: Suivi des offsets par fichier
const inflightProcesses = new Map(); // W-01: Mutex for concurrent file processing
const RETURN_GAP_DAYS = parseInt(process.env.ERROR_RETURN_GAP_DAYS || '7', 10);

// W-01: Enqueue file processing to prevent race conditions
async function enqueueFileProcessing(filePath, fn) {
  const prev = inflightProcesses.get(filePath) || Promise.resolve();
  const next = prev.then(fn, fn).finally(() => {
    if (inflightProcesses.get(filePath) === next) {
      inflightProcesses.delete(filePath);
    }
  });
  inflightProcesses.set(filePath, next);
  return next;
}

function getDirs() {
  const dirs = (process.env.WATCH_DIRS || './logs').split(',').map(d => d.trim()).filter(Boolean);
  for (const d of dirs) {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
    }
  }
  return dirs;
}

async function parseDirOwners() {
  const mapping = process.env.WATCH_DIR_USER_MAP;
  const owners = {};
  const userIds = new Set();
  
  if (!mapping || mapping.trim() === '') {
    logger.info({ event: 'watcher_no_mapping' }, '[WATCHER] No directory-to-user mapping defined.');
    return owners;
  }

  for (const entry of mapping.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const [dir, userId] = trimmed.split(':');
    if (!dir || !userId) {
      throw new Error(`Invalid WATCH_DIR_USER_MAP entry: ${entry}`);
    }
    const userIdNum = parseInt(userId, 10);
    if (isNaN(userIdNum)) {
      throw new Error(`Invalid user ID in WATCH_DIR_USER_MAP: ${userId}`);
    }
    owners[path.resolve(dir)] = userIdNum;
    userIds.add(userIdNum);
  }
  
  // S-06: Validate that all user IDs exist in the database
  if (userIds.size > 0) {
    const idArray = Array.from(userIds);
    const placeholders = idArray.map(() => '?').join(', ');
    const [users] = await pool.execute(
      `SELECT id FROM users WHERE id IN (${placeholders})`,
      idArray
    );
    const validIds = new Set(users.map(u => u.id));
    for (const userId of userIds) {
      if (!validIds.has(userId)) {
        logger.warn({ event: 'invalid_watcher_user', userId }, `User ID ${userId} in WATCH_DIR_USER_MAP does not exist in database. Logs for this directory will be orphaned.`);
      }
    }
  }
  
  return owners;
}

let dirOwners = null;

function findOwnerForPath(filePath) {
  const resolvedPath = path.resolve(filePath);
  let matchedUserId = null;
  let matchedDir = '';

  for (const [dir, userId] of Object.entries(dirOwners || {})) {
    const resolvedDir = path.resolve(dir);
    if (resolvedPath === resolvedDir || resolvedPath.startsWith(resolvedDir + path.sep)) {
      if (resolvedDir.length > matchedDir.length) {
        matchedDir = resolvedDir;
        matchedUserId = userId;
      }
    }
  }

  return matchedUserId;
}

// W-02: Load persisted offsets from database on startup
async function loadPersistedOffsets() {
  try {
    const [rows] = await pool.execute('SELECT path, offset FROM watch_offsets');
    for (const row of rows) {
      fileOffsets.set(row.path, row.offset);
    }
    logger.info({ event: 'loaded_persisted_offsets', count: rows.length }, '[WATCHER]');
  } catch (e) {
    logger.warn({ event: 'could_not_load_persisted_offsets', error: e.message }, '[WATCHER]');
  }
}

// W-02: Persist offset to database
async function persistOffset(filePath, offset) {
  try {
    await pool.execute(
      'INSERT INTO watch_offsets (path, offset, updated_at) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE offset = ?, updated_at = NOW()',
      [filePath, offset, offset]
    );
  } catch (e) {
    logger.warn({ event: 'could_not_persist_offset', filePath, error: e.message }, '[WATCHER]');
  }
}

async function processLogFile(filePath, incremental = true) {
  try {
    const stats = fs.statSync(filePath);
    const currentSize = stats.size;
    const lastOffset = fileOffsets.get(filePath) || 0;
    
    // W-03: Detect file rotation (logrotate): if file was truncated, reset offset
    if (incremental && currentSize < lastOffset) {
      logger.info({ event: 'file_rotation_detected', filePath, currentSize, lastOffset }, '[WATCHER]');
      fileOffsets.set(filePath, 0);
      await persistOffset(filePath, 0);
      // Re-process the entire rotated file
      return enqueueFileProcessing(filePath, () => processLogFile(filePath, false));
    }
    
    // FIX #4: Mode incrémental - lire seulement les nouvelles données
    let content;
    if (incremental && currentSize > lastOffset) {
      const buffer = Buffer.allocUnsafe(currentSize - lastOffset);
      const fd = fs.openSync(filePath, 'r');
      fs.readSync(fd, buffer, 0, buffer.length, lastOffset);
      fs.closeSync(fd);
      content = buffer.toString('utf8');
      fileOffsets.set(filePath, currentSize);
      // W-02: Persist the new offset
      await persistOffset(filePath, currentSize);
    } else if (!incremental) {
      content = fs.readFileSync(filePath, 'utf8');
      fileOffsets.set(filePath, currentSize);
      // W-02: Persist the offset
      await persistOffset(filePath, currentSize);
    } else {
      // Fichier non modifié
      return;
    }
    
    if (!content.trim()) return;
    
    // V5: Use universal parser for multiple format support
    const detected = detectFormat(Buffer.from(content));
    const parsed = await parseLogContent(Buffer.from(content), detected);
    if (!parsed.length) return;

    // FIX #9: Enrichissement hors DB pour optimiser les connexions
    const userId = findOwnerForPath(filePath) || null;
    
    if (!userId) {
      logger.warn({ event: 'orphan_log_detected', filePath }, '[WATCHER] File has no assigned owner in WATCH_DIR_USER_MAP. Logs will be imported with user_id = NULL.');
    }

    const entries = parsed.map(entry => ({
      ...entry,
      normalized_message: normalizeMessage(entry.message),
      event_type: classifyLog(entry.message, entry.service || 'watched', entry.service),
      fingerprint: generateFingerprint(entry.service, classifyLog(entry.message, entry.service || 'watched', entry.service), normalizeMessage(entry.message), userId),
      log_level: normalizeLevel(entry.log_level || 'INFO'),
      log_format: detected,
      user_id: userId,
      source_server: entry.source_server || entry.host || entry.source || path.basename(filePath),
      created_time: entry.created_time || String(entry.timestamp || '').slice(11, 19) || null,
      timezone: entry.timezone || null,
      timestamp_inferred: entry.timestamp_inferred ? 1 : 0,
      classification_confidence: entry.classification_confidence || null,
      source_type: 'watch'
    }));

    // FIX #9: UNE seule connexion pour tout le fichier
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      
      // P-04: V5 bulk insert with new metadata columns
      const logValues = entries.map(entry => [
        entry.raw_log,
        entry.timestamp,
        entry.created_time,
        entry.timezone,
        entry.log_level,
        entry.source,
        entry.source_server,
        entry.service,
        entry.message,
        entry.normalized_message,
        entry.event_type,
        entry.fingerprint,
        entry.user_id,
        entry.source_type,
        entry.ip_address || entry.client_ip || null,
        entry.module || null,
        entry.error_type || null,
        entry.stack_trace || null,
        entry.target_user || null,
        entry.log_format || null,
        entry.timestamp_inferred,
        entry.classification_confidence
      ]);

      const [logResult] = await conn.query(
        `INSERT IGNORE INTO logs (
          raw_log, timestamp, created_time, timezone, log_level, source, source_server, service, message, normalized_message,
          event_type, fingerprint, user_id, source_type, client_ip, module, error_type, stack_trace,
          target_user, parser_format, timestamp_inferred, classification_confidence
        ) VALUES ?`,
        [logValues]
      );

      // P-04: Aggregate error_groups update with ON DUPLICATE KEY UPDATE
      // IMPORTANT: on ne peut pas se baser sur logResult.insertId avec INSERT IGNORE.
      // On calcule plutôt sample_log_id via une sélection sûre (id réel du log correspondant).
      const errorGroupUpdates = [];
      const errorGroupParams = [];
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];

        // sample_log_id : log_id réel le plus proche correspondant fingerprint + timestamp + user_id
        // (on prend le max id pour coller au dernier log potentiellement inséré)
        errorGroupUpdates.push(
          `(?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`
        );

        errorGroupParams.push(
          entry.fingerprint,
          (entry.message || '').slice(0, 500),
          entry.event_type,
          entry.log_level,
          entry.timestamp,
          entry.timestamp,
          entry.source_server,
          entry.service,
          entry.error_type,
          entry.user_id
        );
      }

      // Si aucun entry => rien à faire
      if (errorGroupUpdates.length > 0) {
        await conn.query(
          `INSERT INTO error_groups (fingerprint, title, event_type, severity_max, occurrence_count, first_seen, last_seen, source_server, service, error_type, user_id)
           VALUES ${errorGroupUpdates.join(',')}
           ON DUPLICATE KEY UPDATE
             occurrence_count = occurrence_count + 1,
             previous_seen = IF(VALUES(last_seen) > last_seen, last_seen, previous_seen),
             return_reason = IF(
               (status = 'resolved' OR TIMESTAMPDIFF(DAY, last_seen, VALUES(last_seen)) >= ?)
               AND VALUES(last_seen) > last_seen,
               CONCAT('Erreur deja observee le ', DATE_FORMAT(first_seen, '%Y-%m-%d %H:%i:%s'),
                      ', absente depuis ', TIMESTAMPDIFF(DAY, last_seen, VALUES(last_seen)),
                      ' jour(s), puis reapparue le ', DATE_FORMAT(VALUES(last_seen), '%Y-%m-%d %H:%i:%s')),
               return_reason
             ),
             returned_at = IF(
               (status = 'resolved' OR TIMESTAMPDIFF(DAY, last_seen, VALUES(last_seen)) >= ?)
               AND VALUES(last_seen) > last_seen,
               VALUES(last_seen),
               returned_at
             ),
             return_count = IF(
               (status = 'resolved' OR TIMESTAMPDIFF(DAY, last_seen, VALUES(last_seen)) >= ?)
               AND VALUES(last_seen) > last_seen,
               return_count + 1,
               return_count
             ),
             status = IF(
               (status = 'resolved' OR TIMESTAMPDIFF(DAY, last_seen, VALUES(last_seen)) >= ?)
               AND VALUES(last_seen) > last_seen,
               'returned',
               'open'
             ),
             last_seen = GREATEST(last_seen, VALUES(last_seen)),
             first_seen = LEAST(first_seen, VALUES(first_seen)),
             source_server = COALESCE(VALUES(source_server), source_server),
             service = COALESCE(VALUES(service), service),
             error_type = COALESCE(VALUES(error_type), error_type),
             severity_max = IF(
               FIELD(VALUES(severity_max), 'DEBUG','INFO','WARNING','ERROR','CRITICAL','FATAL') >
               FIELD(severity_max,         'DEBUG','INFO','WARNING','ERROR','CRITICAL','FATAL'),
               VALUES(severity_max),
               severity_max
             )`,
          [...errorGroupParams, RETURN_GAP_DAYS, RETURN_GAP_DAYS, RETURN_GAP_DAYS, RETURN_GAP_DAYS]
        );
      }


      await conn.commit();
    } catch (e) {
      await conn.rollback();
      logger.error({ event: 'batch_insert_error', error: e.message }, '[WATCHER]');
    } finally {
      conn.release();
    }
    logger.info({ event: 'lines_processed', count: parsed.length, filePath }, '[WATCHER]');
    
    // FIX #5: Déclencher évaluation alertes + flux temps réel (Watch Log)
    if (parsed.length > 0) {
      alertWorker.broadcastLogBatch(entries, { userId });
      alertEngineBus.emit('logs.inserted', { userId, count: parsed.length });
    }
  } catch (e) {
    logger.error({ event: 'processing_error', filePath, error: e.message }, '[WATCHER]');
  }
}

export async function startWatcher() {
  // S-06: Initialize dirOwners asynchronously with validation
  dirOwners = await parseDirOwners();
  
  // W-02: Load persisted offsets from database
  await loadPersistedOffsets();
  
  const dirs = getDirs();
  if (dirs.length === 0) {
    logger.info({ event: 'no_directories_to_watch' }, '[WATCHER]');
    return null;
  }

  logger.info({ event: 'watching_directories', directories: dirs.join(', ') }, '[WATCHER]');

  watcher = chokidar.watch(dirs, {
    ignored: /(^|[\/\\])\../,
    persistent: true,
    usePolling: false, // ✅ Observation #6 CORRIGÉ : mode natif pour latence ms vs 30s
    awaitWriteFinish: {
      stabilityThreshold: 250, // P-08: Reduced from 2000ms to 250ms for faster detection
      pollInterval: 100
    }
  });

  watcher.on('add', (filePath) => {
    const ext = filePath.split('.').pop().toLowerCase();
    if (['log', 'txt', 'json', 'jsonl'].includes(ext)) {
      // W-01: Use enqueueFileProcessing to prevent race conditions
      enqueueFileProcessing(filePath, () => processLogFile(filePath, false));
    }
  });

  watcher.on('change', (filePath) => {
    const ext = filePath.split('.').pop().toLowerCase();
    if (['log', 'txt', 'json', 'jsonl'].includes(ext)) {
      // W-01: Use enqueueFileProcessing to prevent race conditions
      enqueueFileProcessing(filePath, () => processLogFile(filePath, true));
    }
  });

  watcher.on('error', (error) => {
    logger.error({ event: 'watcher_error', error: error.message }, '[WATCHER]');
  });
}

export function stopWatcher() {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}

export function getWatcherStatus() {
  const dirs = getDirs();
  const mappedDirs = Object.keys(dirOwners || {});
  const resolvedDirs = dirs.map(d => path.resolve(d));
  const unmappedCount = resolvedDirs.filter(d => !mappedDirs.includes(d)).length;

  return {
    running: watcher !== null,
    watched_files: fileOffsets.size,
    dirs,
    unmapped_dirs: unmappedCount,
    inflight: inflightProcesses.size
  };
}

/* AMÉLIORATION 4: Anomaly detection - compare current error rate vs baseline */
export async function detectAnomalies(userId, windowMinutes = 10) {
  let conn;
  try {
    conn = await pool.getConnection();

    // Get current error rate in the last windowMinutes
    const [currentLogs] = await conn.query(
      `SELECT COUNT(*) as count, COUNT(CASE WHEN log_level IN ('ERROR', 'CRITICAL', 'FATAL') THEN 1 END) as errors
       FROM logs 
       WHERE user_id = ? AND timestamp >= DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
      [userId, windowMinutes]
    );

    // Get baseline: average error rate from past 24 hours (excluding last windowMinutes)
    const [baselineLogs] = await conn.query(
      `SELECT COUNT(*) as count, COUNT(CASE WHEN log_level IN ('ERROR', 'CRITICAL', 'FATAL') THEN 1 END) as errors
       FROM logs 
       WHERE user_id = ? AND timestamp >= DATE_SUB(NOW(), INTERVAL 1 DAY) AND timestamp < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
      [userId, windowMinutes]
    );

    const current = currentLogs[0] || { count: 0, errors: 0 };
    const baseline = baselineLogs[0] || { count: 0, errors: 0 };

    if (!current.count || !baseline.count) {
      return { anomaly_detected: false, reason: 'Insufficient data' };
    }

    const currentErrorRate = (current.errors / current.count) * 100;
    const baselineErrorRate = (baseline.errors / baseline.count) * 100;
    const rateIncrease = baselineErrorRate > 0
      ? ((currentErrorRate / baselineErrorRate) * 100 - 100)
      : currentErrorRate > 0 ? 100 : 0;

    const isAnomaly = currentErrorRate > baselineErrorRate * 1.5 || currentErrorRate > 30;

    return {
      anomaly_detected: isAnomaly,
      window_minutes: windowMinutes,
      current_count: current.count,
      baseline_count: baseline.count,
      current_errors: current.errors,
      baseline_errors: baseline.errors,
      current_rate: parseFloat(currentErrorRate.toFixed(2)),
      baseline_rate: parseFloat(baselineErrorRate.toFixed(2)),
      threshold_exceeded: currentErrorRate > 30,
      rate_increase_percent: parseFloat(rateIncrease.toFixed(1))
    };
  } catch (error) {
    logger.error({ event: 'anomaly_detection_error', error: error.message }, '[WATCHER]');
    return { anomaly_detected: false, error: error.message };
  } finally {
    if (conn) {
      try { conn.release(); } catch (_) {}
    }
  }
}

/* AMÉLIORATION 4: Get real-time statistics for watch dashboard */
export async function getWatchStats(userId) {
  let conn;
  try {
    conn = await pool.getConnection();

    // Stats for last hour
    const [stats] = await conn.query(
      `SELECT 
        COUNT(*) as total_logs,
        COUNT(CASE WHEN log_level = 'DEBUG' THEN 1 END) as debug_count,
        COUNT(CASE WHEN log_level = 'INFO' THEN 1 END) as info_count,
        COUNT(CASE WHEN log_level = 'WARNING' THEN 1 END) as warning_count,
        COUNT(CASE WHEN log_level = 'ERROR' THEN 1 END) as error_count,
        COUNT(CASE WHEN log_level = 'CRITICAL' THEN 1 END) as critical_count,
        COUNT(CASE WHEN log_level = 'FATAL' THEN 1 END) as fatal_count,
        COUNT(DISTINCT source) as sources,
        COUNT(DISTINCT service) as services,
        COUNT(DISTINCT module) as modules,
        MIN(timestamp) as first_log,
        MAX(timestamp) as last_log
       FROM logs 
       WHERE user_id = ? AND imported_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
      [userId]
    );

    // Top errors
    const [topErrors] = await conn.query(
      `SELECT fingerprint, event_type, COUNT(*) as count, MAX(timestamp) as last_seen
       FROM logs
       WHERE user_id = ? AND log_level IN ('ERROR', 'CRITICAL', 'FATAL') AND imported_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
       GROUP BY fingerprint
       ORDER BY count DESC
       LIMIT 5`,
      [userId]
    );

    // Throughput per minute (last 60 minutes)
    const [throughput] = await conn.query(
      `SELECT DATE_FORMAT(imported_at, '%Y-%m-%d %H:%i') as minute, COUNT(*) as count
       FROM logs
       WHERE user_id = ? AND imported_at >= DATE_SUB(NOW(), INTERVAL 60 MINUTE)
       GROUP BY minute
       ORDER BY minute DESC`,
      [userId]
    );

    // logs_per_min (pour compat front WatchLog)
    const total = stats[0]?.total_logs ?? 0;
    const logs_per_min = total > 0 ? total / 60 : 0;

    return {
      stats: {
        ...(stats[0] || {}),
        logs_per_min
      },
      top_errors: topErrors || [],
      throughput: throughput || []
    };
  } catch (error) {
    logger.error({ event: 'stats_error', error: error.message }, '[WATCHER]');
    return { error: error.message };
  } finally {
    if (conn) {
      try { conn.release(); } catch (_) {}
    }
  }
}
