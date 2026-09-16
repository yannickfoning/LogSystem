export function normalizeLevel(level) {
  const raw = String(level ?? 'INFO').trim();
  const l = raw.toUpperCase();

  const aliases = {
    TRACE: 'TRACE',
    DEBUG: 'DEBUG',
    INFO: 'INFO',
    NOTICE: 'INFO',
    WARN: 'WARNING',
    WARNING: 'WARNING',
    ERR: 'ERROR',
    ERROR: 'ERROR',
    CRITICAL: 'CRITICAL',
    FATAL: 'FATAL',
    ALERT: 'ERROR',
    SECURITY: 'SECURITY',
  };

  return aliases[l] || 'INFO';
}

export default { normalizeLevel };
