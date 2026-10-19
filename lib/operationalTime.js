/**
 * Operational time for dashboards, alerts, and live views.
 * Uses ingestion time so bulk imports appear in "today" windows on Render/cloud.
 */
export const OPERATIONAL_TS = 'imported_at';

/** SQL expression: prefer ingestion time, fall back to event/created time. */
export const OPERATIONAL_TS_EXPR = 'COALESCE(imported_at, timestamp, created_at)';

export function isCloudDeployment() {
  return !!(
    process.env.VERCEL ||
    process.env.VERCEL_ENV ||
    process.env.RENDER ||
    process.env.RENDER_SERVICE_NAME
  );
}

/** MySQL DATETIME string in UTC (YYYY-MM-DD HH:MM:SS). */
export function toMysqlUtcDatetime(date) {
  return new Date(date).toISOString().slice(0, 19).replace('T', ' ');
}

/** UTC calendar day bounds for a YYYY-MM-DD string (inclusive end-of-day). */
export function utcBoundsForCalendarDate(dateStr) {
  const day = String(dateStr).slice(0, 10);
  return {
    start: `${day} 00:00:00`,
    end: `${day} 23:59:59`,
  };
}

/** UTC bounds for "today" (server clock, UTC calendar). */
export function utcTodayBounds(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  return utcBoundsForCalendarDate(day);
}

/** Calendar "today" in LOG_TIMEZONE (ex. Africa/Douala) — aligné avec les utilisateurs métier. */
export function operationalTodayBounds(now = new Date()) {
  const tz = process.env.LOG_TIMEZONE || 'UTC';
  if (tz === 'UTC') return utcTodayBounds(now);
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return utcBoundsForCalendarDate(day);
}

/** UTC DATETIME N minutes ago (for sliding windows). */
export function mysqlUtcMinutesAgo(minutes, now = new Date()) {
  return toMysqlUtcDatetime(new Date(now.getTime() - minutes * 60000));
}
