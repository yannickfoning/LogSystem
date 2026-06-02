const severityOrder = { DEBUG: 1, INFO: 2, WARNING: 3, ERROR: 4, CRITICAL: 5, FATAL: 6 };

export function levelSeverity(level) {
  if (!level) return 0;
  const key = String(level).toUpperCase().trim();
  return severityOrder[key] ?? 0;
}

export function normalizeLevel(raw) {
  if (!raw) return 'INFO';
  const s = String(raw).toUpperCase().trim();
  if (['DEBUG', 'DBG', 'TRACE'].includes(s)) return 'DEBUG';
  if (s === 'WARN' || s === 'WARNING') return 'WARNING';
  if (s === 'CRIT') return 'CRITICAL';
  if (s === 'CRITICAL') return 'CRITICAL';
  if (['ERR', 'ERROR'].includes(s)) return 'ERROR';
  if (s === 'EMERG') return 'FATAL';
  if (s === 'EMERGENCY') return 'FATAL';
  if (s === 'FATAL') return 'FATAL';
  return 'INFO';
}

export const LEVEL_COLORS = {
  DEBUG: '#888888',
  INFO: '#2E75B6',
  WARNING: '#ED7D31',
  ERROR: '#C00000',
  CRITICAL: '#7030A0',
  FATAL: '#000000'
};

