export const LOG_LEVELS = {
  TRACE: 0,
  DEBUG: 10,
  INFO: 20,
  WARNING: 30,
  WARN: 30,
  ERROR: 40,
  CRITICAL: 50,
  FATAL: 60,
} as const;

export type LogLevel = keyof typeof LOG_LEVELS;

export function getLevelPriority(level: string): number {
  const normalized = level.toUpperCase().replace('WARN', 'WARNING');
  return LOG_LEVELS[normalized as LogLevel] ?? LOG_LEVELS.INFO;
}

export function normalizeLevel(level: string): string {
  const upper = level.toUpperCase().trim();
  switch (upper) {
    case 'TRACE': return 'TRACE';
    case 'DEBUG': return 'DEBUG';
    case 'INFO': return 'INFO';
    case 'WARN':
    case 'WARNING': return 'WARNING';
    case 'ERROR': return 'ERROR';
    case 'CRITICAL': return 'CRITICAL';
    case 'FATAL': return 'FATAL';
    default: return 'INFO';
  }
}

export function isErrorLevel(level: string): boolean {
  return getLevelPriority(level) >= LOG_LEVELS.ERROR;
}

export function isFatalLevel(level: string): boolean {
  return getLevelPriority(level) >= LOG_LEVELS.FATAL;
}

export function isCriticalLevel(level: string): boolean {
  return getLevelPriority(level) >= LOG_LEVELS.CRITICAL;
}

export const LEVEL_COLORS: Record<string, string> = {
  TRACE: '#6b7280',
  DEBUG: '#8b5cf6',
  INFO: '#3b82f6',
  WARNING: '#f59e0b',
  ERROR: '#ef4444',
  CRITICAL: '#dc2626',
  FATAL: '#991b1b',
};
