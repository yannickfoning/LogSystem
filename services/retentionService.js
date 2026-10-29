import logger from '../config/logger.js';
import pool from '../config/database.js';
import { invalidateAllDashboards, invalidateDashboard } from './cacheService.js';

// Politique de rétention par niveau de journal.
const retentionDays = {
  TRACE: 7,
  DEBUG: 7,
  INFO: 30,
  WARNING: 60,
  ERROR: 90,
  CRITICAL: 180,
  FATAL: 365,
  SECURITY: 365
};

const configuredCronHour = Number.parseInt(process.env.RETENTION_CRON_HOUR || '3', 10);
const CRON_HOUR = Number.isInteger(configuredCronHour) && configuredCronHour >= 0 && configuredCronHour <= 23
  ? configuredCronHour
  : 3;
let retentionSchedulerStarted = false;
let scheduledRetentionRunning = false;
let lastSuccessfulScheduledRunDate = null;
let retentionQueue = Promise.resolve();
let retentionRetryTimer = null;

const RETENTION_MAX_ATTEMPTS = 3;
const RETENTION_RETRY_BASE_MS = 1000;
const RETENTION_SCHEDULE_RETRY_MS = 5 * 60 * 1000;
const transientDatabaseErrorCodes = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'EPIPE',
  'ETIMEDOUT',
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
  'PROTOCOL_ENQUEUE_AFTER_QUIT'
]);

function isTransientDatabaseError(error) {
  if (transientDatabaseErrorCodes.has(error?.code)) return true;
  return /connection (?:is )?(?:in )?closed|connection lost|server closed the connection|socket hang up|ECONN(?:ABORTED|REFUSED|RESET)|EHOSTUNREACH|EPIPE|ETIMEDOUT/i
    .test(error?.message || '');
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function getNextRun() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(CRON_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

function getLocalDateKey(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function getRetentionDate(level) {
  const days = retentionDays[level] || 30;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

// FIX RETENTION-01: userId = null → admin global (tous), userId = number → scoped
function buildUserFilter(userId) {
  return userId != null ? ' AND user_id = ?' : '';
}
function buildUserParams(userId) {
  return userId != null ? [userId] : [];
}

// ── runRetention(userId) ───────────────────────────────────────────────────────
// userId = null  → admin global, purge tous les tenants
// userId = N     → purge uniquement les logs de cet utilisateur
async function runRetentionOnce(userId) {
  let conn;
  let transactionStarted = false;
  let destroyConnection = false;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    transactionStarted = true;
    const results = {};
    const scopeSql    = buildUserFilter(userId);
    const scopeParams = buildUserParams(userId);

    for (const [level, days] of Object.entries(retentionDays)) {
      const date = getRetentionDate(level);
      const [r] = await conn.execute(
        `DELETE FROM logs WHERE log_level = ? AND timestamp < ?${scopeSql}`,
        [level, date, ...scopeParams]
      );
      results[level] = { days, deleted: r.affectedRows };
    }

    // Purger les groupes sans journal correspondant du même utilisateur.
    // Ignorer si la table error_groups n'existe pas ou a une structure différente
    if (userId == null) {
      try {
        const [orphans] = await conn.execute(
          `DELETE eg FROM error_groups eg
           WHERE NOT EXISTS (
             SELECT 1 FROM logs l
             WHERE l.fingerprint = eg.fingerprint
               AND l.user_id <=> eg.user_id
           )`
        );
        results.orphan_error_groups = orphans.affectedRows;
      } catch (groupError) {
        // Ignorer l'erreur de nettoyage des groupes (la rétention des logs a réussi)
        logger.warn({ event: 'retention_groups_skipped', error: groupError.message }, '[RETENTION]');
        results.orphan_error_groups = 0;
      }
    }

    // Purger les alertes lues anciennes avec scope
    // Ignorer si la table alerts n'existe pas ou a une structure différente
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);
      const [alerts] = await conn.execute(
        `DELETE FROM alerts WHERE status = ? AND read_at < ?${scopeSql}`,
        ['read', cutoff.toISOString().slice(0, 19).replace('T', ' '), ...scopeParams]
      );
      results.read_alerts = alerts.affectedRows;
    } catch (alertError) {
      // Ignorer l'erreur de suppression des alertes (la rétention des logs a réussi)
      logger.warn({ event: 'retention_alerts_skipped', error: alertError.message }, '[RETENTION]');
      results.read_alerts = 0;
    }

    // FIX #15: Purger les alertes non lues anciennes (90 jours max)
    // Ignorer si la table alerts n'existe pas ou a une structure différente
    try {
      const oldCutoff = new Date();
      oldCutoff.setDate(oldCutoff.getDate() - 90);
      const [oldAlerts] = await conn.execute(
        `DELETE FROM alerts WHERE created_at < ?${scopeSql}`,
        [oldCutoff.toISOString().slice(0, 19).replace('T', ' '), ...scopeParams]
      );
      results.old_alerts = oldAlerts.affectedRows;
    } catch (oldAlertError) {
      // Ignorer l'erreur de suppression des alertes (la rétention des logs a réussi)
      logger.warn({ event: 'retention_old_alerts_skipped', error: oldAlertError.message }, '[RETENTION]');
      results.old_alerts = 0;
    }

    await conn.commit();
    transactionStarted = false;
    if (userId == null) {
      try {
        await invalidateAllDashboards();
      } catch (cacheError) {
        logger.warn({ event: 'retention_cache_invalidation_failed', error: cacheError.message }, '[RETENTION]');
      }
    } else {
      try {
        await invalidateDashboard(userId);
      } catch (cacheError) {
        logger.warn({ event: 'retention_cache_invalidation_failed', error: cacheError.message }, '[RETENTION]');
      }
    }
    return results;
  } catch (e) {
    if (isTransientDatabaseError(e)) destroyConnection = true;
    if (transactionStarted) {
      try {
        await conn.rollback();
      } catch (rollbackError) {
        destroyConnection = true;
        logger.warn({ event: 'retention_rollback_failed', error: rollbackError.message }, '[RETENTION]');
      }
    }
    throw e;
  } finally {
    if (conn) {
      if (destroyConnection && typeof conn.destroy === 'function') conn.destroy();
      else conn.release();
    }
  }
}

async function runRetentionWithRetry(userId) {
  for (let attempt = 1; attempt <= RETENTION_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await runRetentionOnce(userId);
    } catch (error) {
      if (!isTransientDatabaseError(error) || attempt === RETENTION_MAX_ATTEMPTS) throw error;
      const delayMs = RETENTION_RETRY_BASE_MS * (2 ** (attempt - 1));
      logger.warn({
        event: 'retention_retry',
        attempt,
        maxAttempts: RETENTION_MAX_ATTEMPTS,
        delayMs,
        error: error.message
      }, '[RETENTION]');
      await wait(delayMs);
    }
  }
}

// Serialize the startup, scheduled, and manually requested passes so a large
// purge cannot overlap another retention transaction in this process.
export function runRetention(userId = null) {
  const run = retentionQueue.then(() => runRetentionWithRetry(userId));
  retentionQueue = run.catch(() => undefined);
  return run;
}

// ── getRetentionStats(userId) ─────────────────────────────────────────────────
export async function getRetentionStats(userId = null) {
  const scopeSql    = buildUserFilter(userId);
  const scopeParams = buildUserParams(userId);
  const byLevel = {};

  for (const [level, days] of Object.entries(retentionDays)) {
    const cutoff = getRetentionDate(level);
    const [rows] = await pool.execute(
      `SELECT COUNT(*) as cnt FROM logs WHERE log_level = ? AND timestamp >= ?${scopeSql}`,
      [level, cutoff, ...scopeParams]
    );
    const [totalRows] = await pool.execute(
      `SELECT COUNT(*) as cnt FROM logs WHERE log_level = ?${scopeSql}`,
      [level, ...scopeParams]
    );
    byLevel[level] = {
      days,
      retained: rows[0].cnt,
      total:    totalRows[0].cnt,
      cutoff
    };
  }
  return { by_level: byLevel };
}

// ── Scheduler — tourne toujours en mode global (admin) ───────────────────────
export function startRetentionScheduler() {
  if (retentionSchedulerStarted) return;
  retentionSchedulerStarted = true;

  const clearRetentionRetry = () => {
    if (retentionRetryTimer) {
      clearTimeout(retentionRetryTimer);
      retentionRetryTimer = null;
    }
  };

  const scheduleRetentionRetry = () => {
    if (retentionRetryTimer) return;
    retentionRetryTimer = setTimeout(() => {
      retentionRetryTimer = null;
      void executeScheduledRun();
    }, RETENTION_SCHEDULE_RETRY_MS);
  };

  async function executeScheduledRun() {
    const runDate = getLocalDateKey();
    if (lastSuccessfulScheduledRunDate === runDate) return;
    if (scheduledRetentionRunning) {
      logger.warn({ event: 'retention_run_skipped', reason: 'previous_run_still_active' }, '[RETENTION]');
      return;
    }

    clearRetentionRetry();
    scheduledRetentionRunning = true;
    try {
      const result = await runRetention();
      lastSuccessfulScheduledRunDate = getLocalDateKey();
      logger.info({ event: 'retention_completed', result: JSON.stringify(result) }, '[RETENTION]');
    } catch (error) {
      logger.error({ event: 'retention_error', error: error.message }, '[RETENTION]');
      scheduleRetentionRetry();
    } finally {
      scheduledRetentionRunning = false;
    }
  }

  const delay = getNextRun();
  logger.info({ event: 'retention_next_scheduled', minutesUntilNext: Math.round(delay / 60000) }, '[RETENTION]');
  // Catch up after cold starts/restarts, when an in-memory timer may have been lost.
  void executeScheduledRun();
  setTimeout(() => {
    void executeScheduledRun();
    setInterval(() => { void executeScheduledRun(); }, 24 * 60 * 60 * 1000);
  }, delay);
}
