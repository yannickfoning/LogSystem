import pool from '../config/database.js';
import crypto from 'crypto';
import logger from '../config/logger.js';

/**
 * Génère 10 000 logs par jour répartis en 2 intervalles
 * Intervalle 1: 08:00-12:00 (40% des logs) = 4 000 logs
 * Intervalle 2: 14:00-18:00 (60% des logs) = 6 000 logs
 * Avec patterns réalistes et erreurs groupées
 */

const LOG_LEVELS = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL', 'FATAL'];
const SERVICES = ['api-gateway', 'auth-service', 'database-sync', 'notification-worker', 'cache-layer', 'payment-processor'];
const SOURCES = ['production', 'staging', 'monitoring', 'backup', 'scheduler'];
const ERROR_PATTERNS = [
  { type: 'CONNECTION_TIMEOUT', message: 'Database connection timeout after 30s', level: 'ERROR' },
  { type: 'AUTH_FAILURE', message: 'Invalid JWT token signature', level: 'WARNING' },
  { type: 'MEMORY_LEAK', message: 'Heap size exceeds threshold', level: 'CRITICAL' },
  { type: 'DISK_FULL', message: 'Storage capacity at 95%', level: 'CRITICAL' },
  { type: 'RATE_LIMIT', message: 'Rate limit exceeded for user', level: 'WARNING' },
  { type: 'CACHE_MISS', message: 'Cache eviction occurred', level: 'INFO' },
  { type: 'DEADLOCK', message: 'Database deadlock detected', level: 'CRITICAL' },
  { type: 'NETWORK_ERROR', message: 'Network unreachable', level: 'ERROR' }
];

function generateFingerprint(errorType, service) {
  return crypto.createHash('sha1').update(`${errorType}:${service}:prod`).digest('hex').substring(0, 40);
}

function generateLog(timestamp, userId) {
  const errorPattern = ERROR_PATTERNS[Math.floor(Math.random() * ERROR_PATTERNS.length)];
  const service = SERVICES[Math.floor(Math.random() * SERVICES.length)];
  const source = SOURCES[Math.floor(Math.random() * SOURCES.length)];

  return {
    raw_log: JSON.stringify({
      timestamp: timestamp.toISOString(),
      level: errorPattern.level,
      service,
      message: errorPattern.message
    }),
    timestamp,
    event_timestamp: timestamp,
    log_level: errorPattern.level,
    source,
    source_server: `server-${Math.floor(Math.random() * 5) + 1}`,
    service,
    message: errorPattern.message,
    error_type: errorPattern.type,
    event_type: 'system_event',
    fingerprint: generateFingerprint(errorPattern.type, service),
    user_id: userId,
    module: `module_${Math.floor(Math.random() * 3) + 1}`,
    imported_at: new Date()
  };
}

async function seedProductionLogs() {
  const batchSize = 500;
  const userId = 1; // Admin user
  const logsPerDay = 10000;
  const startDate = new Date('2026-08-01');
  const endDate = new Date('2026-09-14');

  logger.info({ event: 'seed_start', logsPerDay, startDate, endDate }, '[SEED]');

  let totalInserted = 0;

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const currentDate = new Date(d);
    const morning = Math.floor(logsPerDay * 0.4); // 08:00-12:00
    const afternoon = Math.floor(logsPerDay * 0.6); // 14:00-18:00

    let logs = [];

    // Générer logs matin (08:00-12:00)
    for (let i = 0; i < morning; i++) {
      const hour = 8 + Math.random() * 4;
      const minute = Math.random() * 60;
      const timestamp = new Date(currentDate);
      timestamp.setHours(Math.floor(hour), Math.floor(minute), Math.floor(Math.random() * 60));
      logs.push(generateLog(timestamp, userId));
    }

    // Générer logs après-midi (14:00-18:00)
    for (let i = 0; i < afternoon; i++) {
      const hour = 14 + Math.random() * 4;
      const minute = Math.random() * 60;
      const timestamp = new Date(currentDate);
      timestamp.setHours(Math.floor(hour), Math.floor(minute), Math.floor(Math.random() * 60));
      logs.push(generateLog(timestamp, userId));
    }

    // Insérer par batch
    for (let i = 0; i < logs.length; i += batchSize) {
      const batch = logs.slice(i, i + batchSize);
      try {
        const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(',');
        const values = batch.flatMap(log => [
          log.raw_log,
          log.timestamp,
          log.event_timestamp,
          log.log_level,
          log.source,
          log.source_server,
          log.service,
          log.message,
          log.error_type,
          log.event_type,
          log.fingerprint,
          log.user_id,
          log.module,
          log.imported_at
        ]);

        await pool.query(
          `INSERT INTO logs (raw_log, timestamp, event_timestamp, log_level, source, source_server, service, message, error_type, event_type, fingerprint, user_id, module, imported_at)
           VALUES ${placeholders}`,
          values
        );

        totalInserted += batch.length;
        logger.info({ event: 'batch_inserted', count: batch.length, total: totalInserted });
      } catch (e) {
        logger.error({ event: 'batch_error', error: e.message, batchIndex: i });
      }
    }
  }

  logger.info({ event: 'seed_complete', totalInserted }, '[SEED]');
  process.exit(0);
}

seedProductionLogs().catch(e => {
  logger.error({ event: 'seed_failed', error: e.message });
  process.exit(1);
});