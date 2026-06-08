/**
 * Retention Service — V4 feature ported
 * Politique de rétention automatique par niveau de sévérité.
 * Planifié toutes les nuits à l'heure définie par RETENTION_CRON_HOUR.
 */
import { db } from './db';

const RETENTION_DAYS: Record<string, number> = {
  DEBUG: 7,
  INFO: 30,
  WARNING: 60,
  ERROR: 90,
  CRITICAL: 180,
  FATAL: 365,
};

const CRON_HOUR = parseInt(process.env.RETENTION_CRON_HOUR || '3', 10);
let retentionTimer: ReturnType<typeof setTimeout> | null = null;

function msUntilNextRun(): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(CRON_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export async function runRetention(scopeUserId?: string): Promise<Record<string, number>> {
  const results: Record<string, number> = {};
  for (const [level, days] of Object.entries(RETENTION_DAYS)) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    try {
      const deleted = await db.log.deleteMany({
        where: {
          logLevel: level,
          timestamp: { lt: cutoff },
          ...(scopeUserId ? { userId: scopeUserId } : {}),
        },
      });
      results[level] = deleted.count;
    } catch (err) {
      console.error(`[RETENTION] Erreur pour ${level}:`, err);
      results[level] = 0;
    }
  }
  console.log('[RETENTION] Rétention exécutée:', results);
  return results;
}

export function startRetentionScheduler() {
  const schedule = () => {
    retentionTimer = setTimeout(async () => {
      try { await runRetention(); } catch (e) { console.error('[RETENTION] Erreur:', e); }
      schedule();
    }, msUntilNextRun());
  };
  schedule();
  console.log(`[RETENTION] Planifiée à ${CRON_HOUR}h00 chaque nuit`);
}

export function stopRetentionScheduler() {
  if (retentionTimer) { clearTimeout(retentionTimer); retentionTimer = null; }
}
