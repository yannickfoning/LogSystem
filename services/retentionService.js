import logger from '../config/logger.js';
import pool from '../config/database.js';

// FIX RETENTION-01: Politique de retention par niveau de severite
const retentionDays = {
  DEBUG: 7,
  INFO: 30,
  WARNING: 60,
  ERROR: 90,
  CRITICAL: 180,
  FATAL: 365
};

const CRON_HOUR = parseInt(process.env.RETENTION_CRON_HOUR || '3', 10);

function getNextRun() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(CRON_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
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
export async function runRetention(userId = null) {
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

    // Purger les groupes d'erreurs orphelins — toujours global (pas de user_id sur error_groups)
    if (userId == null) {
      const [orphans] = await conn.execute(
        `DELETE FROM error_groups WHERE fingerprint NOT IN (
          SELECT DISTINCT fingerprint FROM logs WHERE fingerprint IS NOT NULL
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

    await conn.commit();
    return results;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// ── getRetentionStats(userId) ─────────────────────────────────────────────────
export async function getRetentionStats(userId = null) {
  const scopeSql    = buildUserFilter(userId);
  const scopeParams = buildUserParams(userId);
  const byLevel = {};

  for (const [level, days] of Object.entries(retentionDays)) {
    const [rows] = await pool.execute(
      `SELECT COUNT(*) as cnt FROM logs WHERE log_level = ? AND timestamp >= ?${scopeSql}`,
      [level, getRetentionDate(level), ...scopeParams]
    );
    const [totalRows] = await pool.execute(
      `SELECT COUNT(*) as cnt FROM logs WHERE log_level = ?${scopeSql}`,
      [level, ...scopeParams]
    );
    byLevel[level] = {
      days,
      retained: rows[0].cnt,
      total:    totalRows[0].cnt,
      cutoff:   getRetentionDate(level)
    };
  }
  return { by_level: byLevel };
}

// ── Scheduler — tourne toujours en mode global (admin) ───────────────────────
export function startRetentionScheduler() {
  const delay = getNextRun();
  logger.info({ event: 'retention_next_scheduled', minutesUntilNext: Math.round(delay / 60000) }, '[RETENTION]');
  setTimeout(() => {
    runRetention(null)
      .then(r => logger.info({ event: 'retention_completed', result: JSON.stringify(r) }, '[RETENTION]'))
      .catch(e => logger.error({ event: 'retention_error', error: e.message }, '[RETENTION]'));
    setInterval(() => {
      runRetention(null)
        .then(r => logger.info({ event: 'retention_completed', result: JSON.stringify(r) }, '[RETENTION]'))
        .catch(e => logger.error({ event: 'retention_error', error: e.message }, '[RETENTION]'));
    }, 24 * 60 * 60 * 1000);
  }, delay);
}
