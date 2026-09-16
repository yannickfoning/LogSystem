/**
 * Utility functions for normalizing and comparing log levels.
 * Moved from config/database.js for better separation of concerns.
 */

export function normalizeLevel(level) {
  const raw = String(level ?? 'INFO').trim();
  const l = raw.toUpperCase();

  const numericMap = {
    '10': 'TRACE',
    '20': 'DEBUG',
    '30': 'INFO',
    '40': 'WARNING',
    '50': 'ERROR',
    '60': 'CRITICAL',
  };

  if (numericMap[l]) {
    return numericMap[l];
  }

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

export function levelSeverity(level) {
  const map = {
    'TRACE': 0,
    'DEBUG': 1,
    'INFO': 2,
    'WARNING': 3,
    'ERROR': 4,
    'CRITICAL': 5,
    'FATAL': 6,
    'SECURITY': 7
  };
  return map[normalizeLevel(level)] || 0;
}

export default { normalizeLevel, levelSeverity };