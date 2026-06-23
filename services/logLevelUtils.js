/**
 * Utility functions for normalizing and comparing log levels.
 * Moved from config/database.js for better separation of concerns.
 */

export function normalizeLevel(level) {
  const l = String(level || 'INFO').toUpperCase();
  const valid = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL', 'FATAL', 'SECURITY'];
  return valid.includes(l) ? l : 'INFO';
}

export function levelSeverity(level) {
  const map = {
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