import { normalizeLevel } from '../../services/logLevelUtils.js';

// Keep format detection and both Java parsers on the same accepted line syntax.
export const JAVA_LOG4J_PATTERN = /^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)(?:\s+\[(?<thread1>[^\]]*)\])?\s+(?<level>TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL|CRITICAL)\s+(?:\[(?<logger>[^\]]*)\]\s*)?(?<message>.*)$/;

export function parseJavaLog4jLine(line) {
  const match = String(line).match(JAVA_LOG4J_PATTERN);
  if (!match) return null;

  const groups = match.groups || {};
  return {
    timestamp: match[1],
    thread: groups.thread1 || null,
    level: normalizeLevel(groups.level),
    logger: groups.logger || null,
    message: groups.message || '',
  };
}

export function normalizeJavaLog4jTimestamp(timestamp) {
  if (!timestamp) return null;
  const value = String(timestamp).trim();
  const match = value.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:[.,](\d+))?$/);

  try {
    if (match) {
      const milliseconds = (match[3] || '').padEnd(3, '0').slice(0, 3);
      const date = new Date(`${match[1]}T${match[2]}.${milliseconds}`);
      if (!Number.isNaN(date.getTime())) {
        return date.toISOString().slice(0, 19).replace('T', ' ');
      }
    }

    const fallback = new Date(value.replace(',', '.'));
    return Number.isNaN(fallback.getTime())
      ? null
      : fallback.toISOString().slice(0, 19).replace('T', ' ');
  } catch (_error) {
    return null;
  }
}
