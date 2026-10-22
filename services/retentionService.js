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
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
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
    if (userId == null) {
      const [orphans] = await conn.execute(
        `DELETE eg FROM error_groups eg
         WHERE NOT EXISTS (
           SELECT 1 FROM logs l
           WHERE l.fingerprint = eg.fingerprint
             AND l.user_id <=> eg.user_id
         )`
      );
      results.orphan_error_groups = orphans.affectedRows;
    }

    // Purger les alertes lues anciennes avec scope
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const [alerts] = await conn.execute(
      `DELETE FROM alerts WHERE status = ? AND read_at < ?${scopeSql}`,
      ['read', cutoff.toISOString().slice(0, 19).replace('T', ' '), ...scopeParams]
    );
    results.read_alerts = alerts.affectedRows;

    // FIX #15: Purger les alertes non lues anciennes (90 jours max)
    const oldCutoff = new Date();
    oldCutoff.setDate(oldCutoff.getDate() - 90);
    const [oldAlerts] = await conn.execute(
      `DELETE FROM alerts WHERE created_at < ?${scopeSql}`,
      [oldCutoff.toISOString().slice(0, 19).replace('T', ' '), ...scopeParams]
    );
    results.old_alerts = oldAlerts.affectedRows;

    await conn.commit();
    if (userId == null) {
      await invalidateAllDashboards();
    } else {
      await invalidateDashboard(userId);
    }
    return results;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// Serialize the startup, scheduled, and manually requested passes so a large
// purge cannot overlap another retention transaction in this process.
export function runRetention(userId = null) {
  const run = retentionQueue.then(() => runRetentionOnce(userId));
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

  const executeScheduledRun = async () => {
    const runDate = getLocalDateKey();
    if (lastSuccessfulScheduledRunDate === runDate) return;
    if (scheduledRetentionRunning) {
      logger.warn({ event: 'retention_run_skipped', reason: 'previous_run_still_active' }, '[RETENTION]');
      return;
    }

    scheduledRetentionRunning = true;
    try {
      const result = await runRetention();
      lastSuccessfulScheduledRunDate = getLocalDateKey();
      logger.info({ event: 'retention_completed', result: JSON.stringify(result) }, '[RETENTION]');
    } catch (error) {
      logger.error({ event: 'retention_error', error: error.message }, '[RETENTION]');
    } finally {
      scheduledRetentionRunning = false;
    }
  };

  const delay = getNextRun();
  logger.info({ event: 'retention_next_scheduled', minutesUntilNext: Math.round(delay / 60000) }, '[RETENTION]');
  // Catch up after cold starts/restarts, when an in-memory timer may have been lost.
  void executeScheduledRun();
  setTimeout(() => {
    void executeScheduledRun();
    setInterval(() => { void executeScheduledRun(); }, 24 * 60 * 60 * 1000);
  }, delay);
}
