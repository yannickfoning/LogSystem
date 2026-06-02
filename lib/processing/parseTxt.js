import logger from '../../config/logger.js';

export function parseLogLine(line, opts = {}) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Try JSON
  try {
    const obj = JSON.parse(trimmed);
    return process(obj, opts, trimmed);
  } catch (_) {}

  // Structured patterns
  const structured = tryStructured(trimmed);
  if (structured) {
    return process(structured, opts, trimmed);
  }

  // Fallback
  return process({ message: trimmed }, opts, trimmed);
}

function tryStructured(line) {
  // ISO timestamp pattern: 2024-01-15T10:30:00.000Z ...
  const isoRe = /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\s+(?:\[(\w+)\]|\s*([A-Z]+))\s+(?:\[([^\]]+)\]\s+)?(.*)$/i;
  const m = line.match(isoRe);
  if (m) {
    return {
      timestamp: m[1],
      level: m[2] || m[3],
      service: m[4],
      message: m[5]
    };
  }

  // Syslog-like: Jan 15 10:30:00 hostname service: message
  const syslogRe = /^([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+\S+\s+(\S+?)(?:\[(\d+)\])?:\s+(.*)$/;
  const m2 = line.match(syslogRe);
  if (m2) {
    return {
      timestamp: m2[1],
      service: m2[2],
      message: m2[4]
    };
  }

  // Common: [LEVEL] [service] message
  const bracketRe = /^\[([^\]]+)\]\s+(?:\[([^\]]+)\]\s+)?(.*)$/;
  const m3 = line.match(bracketRe);
  if (m3) {
    return {
      level: m3[1],
      service: m3[2],
      message: m3[3]
    };
  }

  // Apache/Nginx style
  const apacheRe = /^(\S+)\s+(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+"([^"]*)"\s+(\d+)\s+(.*)$/;
  const m4 = line.match(apacheRe);
  if (m4) {
    return {
      timestamp: m4[4],
      source: m4[3],
      message: `${m4[5]} → ${m4[6]} ${m4[7]}`
    };
  }

  return null;
}

function process(p, opts, rawLine = '') {
  const { normalizeLevel } = require_normalize();

  let ts = p.timestamp || p.time || p.date || p.datetime;
  if (ts) {
    try {
      const d = new Date(ts);
      if (isNaN(d.getTime())) ts = null;
      else {
        // L-06: Validate timestamp range (now ± 10 years, +1 day for clock skew)
        const now = Date.now();
        const tenYearsMs = 10 * 365.25 * 24 * 60 * 60 * 1000;
        const oneDayMs = 24 * 60 * 60 * 1000;
        const tsMs = d.getTime();
        
        if (tsMs < now - tenYearsMs || tsMs > now + oneDayMs) {
          logger.warn({ event: 'timestamp_out_of_range', timestamp: ts, adjustedTo: new Date().toISOString() }, '[PARSE]');
          ts = null;
        } else {
          ts = d.toISOString().slice(0, 19).replace('T', ' ');
        }
      }
    } catch (_) {
      ts = null;
    }
  }
  if (!ts) {
    ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  }

  const level = normalizeLevel(p.level || p.log_level || p.severity || opts.defaultLevel);

  return {
    raw_log: rawLine,
    timestamp: ts,
    log_level: level,
    source: p.source || p.host || p.hostname || opts.defaultSource || null,
    service: p.service || p.app || p.component || p.logger || opts.defaultService || null,
    message: p.message || p.msg || '',
    normalized_message: null,
    event_type: null,
    fingerprint: null
  };
}

function require_normalize() {
  // ESM-safe lazy import
  return { normalizeLevel: (v) => {
    if (!v) return 'INFO';
    const s = v.toString().toUpperCase().trim();
    if (['DEBUG', 'DBG', 'TRACE'].includes(s)) return 'DEBUG';
    if (s === 'WARN' || s === 'WARNING') return 'WARNING';
    if (['ERR', 'ERROR', 'CRITICAL'].includes(s)) return 'ERROR';
    if (s === 'FATAL') return 'FATAL';
    return 'INFO';
  }};
}

export function parseTxtContent(content, opts = {}) {
  return content.split('\n')
    .map(line => parseLogLine(line, opts))
    .filter(Boolean);
}
