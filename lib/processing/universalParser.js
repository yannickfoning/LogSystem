/**
 * Universal Log Parser for LogSystem V5
 * Supports: plain text, JSON, JSONL, CSV, XML, Syslog (RFC3164/RFC5424),
 *           Docker, Kubernetes, Apache, Nginx, Java/Log4j, Python, PHP, Odoo
 *
 * Features:
 * - Auto-detection of format
 * - Auto-detection of encoding (UTF-8, ISO-8859-1, CP1252, etc.)
 * - Graceful fallback to plaintext
 * - Comprehensive metadata extraction
 * - Memory-efficient streaming support
 */

import logger from '../../config/logger.js';
import { convertToUtf8 } from './encodingDetector.js';

// Common patterns for parsing
const PATTERNS = {
  iso8601: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[Z+-]/,
  syslogRfc3164: /^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+(.+)/,
  syslogRfc5424: /^<(\d+)>(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/,
  jsonLine: /^\{.*\}$/,
  dockerJson: /"log":"(.+?)","stream":"(stdout|stderr)","time":"(.+?)"/,
  k8sJson: /"timestamp":"(.+?)","log":"(.+?)","stream":"(stdout|stderr)"/,
  apacheCommon: /^(\S+)\s+\S+\s+(\S+)\s+\[(.+?)\]\s+"(\w+)\s+(\S+)\s+(.+?)"\s+(\d+)\s+(\d+)/,
  nginxAccess: /^(\S+)\s+-\s+(\S+)\s+\[(.+?)\]\s+"(\w+)\s+(\S+)\s+(.+?)"\s+(\d+)\s+(\d+)/,
  javaLog4j: /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}),\(\d+\)\s+\[(.+?)\]\s+(\w+)\s+(.+?)(\s+\n|\n|$)/,
  pythonLog: /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2},\d+)\s+(\w+)\s+(.+?)(\s+\n|\n|$)/,
  phpLog: /^\[(.+?)\]\s+PHP\s+(.+?):\s+(.+?)(\s+\n|\n|$)/,
  OdooLog: /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2},\d+\s+\d+\s+(\w+)\s+(.+?)\s+(.+?)$/
};

const LOG_LEVELS = {
  critical: 5, fatal: 5, emerg: 5, alert: 5,
  error: 4, err: 4,
  warning: 3, warn: 3,
  info: 2, notice: 2,
  debug: 1, trace: 1
};

/**
 * Detect log format from buffer
 */
export function detectFormat(buffer) {
  // L-20: Auto-detect encoding first
  const text = convertToUtf8(buffer);

  // JSON / JSONL heuristics based on the beginning + line structure.
  // Test expectation: "{...}\n{...}" => jsonl
  const trimmed = text.trim();
  if (!trimmed) return 'txt';

  // JSONL: at least two JSON objects separated by a newline
  // (common case: {"a":1}\n{"b":2})
  if (/^\{[\s\S]*\}\s*\n\s*\{/.test(trimmed)) return 'jsonl';
  if (/^\[[\s\S]*\]\s*\n\s*\[/.test(trimmed)) return 'jsonl';

  const headLines = trimmed.split('\n').slice(0, 10);

  let scores = {
    json: 0, jsonl: 0, csv: 0, xml: 0, syslog: 0, docker: 0, kubernetes: 0,
    apache: 0, nginx: 0, java: 0, python: 0, php: 0, odoo: 0, plain: 0
  };

  for (const line of headLines) {
    if (!line.trim()) continue;

    if (line.startsWith('{') && line.endsWith('}')) scores.json += 2;
    if (line.match(PATTERNS.jsonLine)) scores.jsonl += 1;

    if (line.startsWith('<') && !line.startsWith('<?xml')) scores.xml += 1;
    if (line.includes(',')) scores.csv += 0.5;

    if (line.match(PATTERNS.syslogRfc3164) || line.match(PATTERNS.syslogRfc5424)) scores.syslog += 2;
    if (line.match(PATTERNS.dockerJson)) scores.docker += 2;
    if (line.match(PATTERNS.k8sJson)) scores.kubernetes += 2;
    if (line.match(PATTERNS.apacheCommon)) scores.apache += 2;
    if (line.match(PATTERNS.nginxAccess)) scores.nginx += 2;
    if (line.match(PATTERNS.javaLog4j)) scores.java += 2;
    if (line.match(PATTERNS.pythonLog)) scores.python += 2;
    if (line.match(PATTERNS.phpLog)) scores.php += 2;
    if (line.match(PATTERNS.OdooLog)) scores.odoo += 2;

    scores.plain += 1;
  }

  const detected = Object.entries(scores).reduce((a, b) => a[1] > b[1] ? a : b)[0];
  return detected === 'plain' ? 'text' : detected;
}

/**
 * Parse log content by format
 */
export async function parseLogContent(buffer, detectedFormat = null, opts = {}) {
  // L-20: Auto-detect encoding first
  const text = convertToUtf8(buffer);
  const format = detectedFormat || detectFormat(buffer);

  try {
    switch (format) {
      case 'json': return parseJsonLogs(text, opts);
      case 'jsonl': return parseJsonLLogs(text, opts);
      case 'csv': return parseCsvLogs(text, opts);
      case 'xml': return parseXmlLogs(text, opts);
      case 'syslog': return parseSyslogLogs(text, opts);
      case 'docker': return parseDockerLogs(text, opts);
      case 'kubernetes': return parseK8sLogs(text, opts);
      case 'apache': return parseApacheLogs(text, opts);
      case 'nginx': return parseNginxLogs(text, opts);
      case 'java': return parseJavaLogs(text, opts);
      case 'python': return parsePythonLogs(text, opts);
      case 'php': return parsePhpLogs(text, opts);
      case 'odoo': return parseOdooLogs(text, opts);
      default: return parsePlainText(text, opts);
    }
  } catch (e) {
    logger.warn({ event: 'parser_format_fallback', format, error: e.message }, '[PARSER]');
    return parsePlainText(text, opts);
  }
}

// ===========================================================================================
// PARSERS FOR EACH FORMAT
// ===========================================================================================

function parseJsonLogs(text, opts = {}) {
  const logs = [];
  try {
    const parsed = JSON.parse(text);
    const items = Array.isArray(parsed) ? parsed : [parsed];

    for (const item of items) {
      if (typeof item === 'object') {
        logs.push(normalizeLog(item, 'json', opts));
      }
    }
  } catch (_e) {
    return [];
  }
  return logs;
}

function parseJsonLLogs(text, opts = {}) {
  const logs = [];
  let parseFailedCount = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (typeof obj === 'object') {
        logs.push(normalizeLog(obj, 'jsonl', opts));
      }
    } catch (e) {
      // FIX #11: Log malformed lines with counter
      parseFailedCount++;
      if (parseFailedCount <= 10) { // Limit logging to avoid spam
        logger.warn({ event: 'parse_failed', line: line.substring(0, 200), format: 'jsonl', error: e.message }, '[PARSER]');
      }
    }
  }
  if (parseFailedCount > 10) {
    logger.warn({ event: 'parse_failed_summary', format: 'jsonl', total_failed: parseFailedCount }, '[PARSER]');
  }
  return logs;
}

function parseCsvLogs(text, opts = {}) {
  const logs = [];
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length === 0) return logs;

  // Try to detect headers
  const firstLine = lines[0];
  let headers = null;
  let startIdx = 0;

  if (firstLine.match(/^(timestamp|time|date|datetime|log_level|level|severity|message|msg|content)/i)) {
    headers = firstLine.split(',').map(h => h.trim().toLowerCase());
    startIdx = 1;
  }

  for (let i = startIdx; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const log = {};

    if (headers) {
      headers.forEach((h, idx) => {
        log[h] = values[idx] || '';
      });
    } else {
      // Map common positions: timestamp, level, message
      log.timestamp = values[0] || '';
      log.log_level = values[1] || 'INFO';
      log.message = values.slice(2).join(' ');
    }

    logs.push(normalizeLog(log, 'csv', opts));
  }

  return logs;
}

function parseXmlLogs(text, opts = {}) {
  const logs = [];
  const logRegex = /<log[^>]*>([\s\S]*?)<\/log>/gi;
  let match;

  while ((match = logRegex.exec(text)) !== null) {
    const content = match[1];
    const log = {
      timestamp: extractXmlTag(content, 'timestamp') || extractXmlTag(content, 'time'),
      log_level: extractXmlTag(content, 'level') || extractXmlTag(content, 'severity'),
      message: extractXmlTag(content, 'message') || content,
      service: extractXmlTag(content, 'service'),
      module: extractXmlTag(content, 'module'),
      stack_trace: extractXmlTag(content, 'stacktrace') || extractXmlTag(content, 'stack')
    };
    logs.push(normalizeLog(log, 'xml', opts));
  }

  return logs;
}

function parseSyslogLogs(text, opts = {}) {
  const logs = [];

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;

    let log = {};

    // RFC 5424
    const m5424 = line.match(PATTERNS.syslogRfc5424);
    if (m5424) {
      const priority = parseInt(m5424[1]);
      const severity = priority % 8;
      log = {
        timestamp: m5424[3],
        host: m5424[4],
        service: m5424[5],
        log_level: getSeverityName(severity),
        message: m5424[8]
      };
    } else {
      // RFC 3164
      const m3164 = line.match(PATTERNS.syslogRfc3164);
      if (m3164) {
        const year = new Date().getFullYear();
        log = {
          timestamp: `${year}-${m3164[1].replace(/\s+/, '-')}`.substring(0, 19),
          host: m3164[2],
          message: m3164[3]
        };
      }
    }

    if (log.message) {
      logs.push(normalizeLog(log, 'syslog', opts));
    }
  }

  return logs;
}

function parseDockerLogs(text, opts = {}) {
  const logs = [];

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      const log = {
        timestamp: obj.time,
        message: obj.log,
        stream: obj.stream,
        log_level: obj.stream === 'stderr' ? 'ERROR' : 'INFO',
        service: 'docker'
      };
      logs.push(normalizeLog(log, 'docker', opts));
    } catch (_e) {
      // Skip malformed lines
    }
  }

  return logs;
}

function parseK8sLogs(text, opts = {}) {
  const logs = [];

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      const log = {
        timestamp: obj.timestamp,
        message: obj.log,
        stream: obj.stream,
        log_level: obj.stream === 'stderr' ? 'ERROR' : 'INFO',
        service: 'kubernetes'
      };
      logs.push(normalizeLog(log, 'kubernetes', opts));
    } catch (_e) {
      // Skip malformed lines
    }
  }

  return logs;
}

function parseApacheLogs(text, opts = {}) {
  const logs = [];

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const m = line.match(PATTERNS.apacheCommon);
    if (m) {
      const log = {
        timestamp: m[3],
        ip_address: m[1],
        client_id: m[2],
        method: m[4],
        path: m[5],
        protocol: m[6],
        status_code: parseInt(m[7]),
        bytes: parseInt(m[8]),
        log_level: m[7].startsWith('4') || m[7].startsWith('5') ? 'ERROR' : 'INFO',
        message: `${m[4]} ${m[5]} ${m[7]}`,
        service: 'apache'
      };
      logs.push(normalizeLog(log, 'apache', opts));
    }
  }

  return logs;
}

function parseNginxLogs(text, opts = {}) {
  const logs = [];

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const m = line.match(PATTERNS.nginxAccess);
    if (m) {
      const log = {
        timestamp: m[3],
        ip_address: m[1],
        client_id: m[2],
        method: m[4],
        path: m[5],
        protocol: m[6],
        status_code: parseInt(m[7]),
        bytes: parseInt(m[8]),
        log_level: m[7].startsWith('4') || m[7].startsWith('5') ? 'ERROR' : 'INFO',
        message: `${m[4]} ${m[5]} ${m[7]}`,
        service: 'nginx'
      };
      logs.push(normalizeLog(log, 'nginx', opts));
    }
  }

  return logs;
}

function parseJavaLogs(text, opts = {}) {
  const logs = [];

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const m = line.match(PATTERNS.javaLog4j);
    if (m) {
      const log = {
        timestamp: m[1],
        thread: m[3],
        log_level: m[4].toUpperCase(),
        message: m[5],
        service: 'java'
      };
      logs.push(normalizeLog(log, 'java', opts));
    }
  }

  return logs;
}

function parsePythonLogs(text, opts = {}) {
  const logs = [];

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const m = line.match(PATTERNS.pythonLog);
    if (m) {
      const log = {
        timestamp: m[1],
        log_level: m[2].toUpperCase(),
        message: m[3],
        service: 'python'
      };
      logs.push(normalizeLog(log, 'python', opts));
    }
  }

  return logs;
}

function parsePhpLogs(text, opts = {}) {
  const logs = [];

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const m = line.match(PATTERNS.phpLog);
    if (m) {
      const log = {
        timestamp: m[1],
        log_level: 'ERROR',
        message: `${m[2]}: ${m[3]}`,
        service: 'php'
      };
      logs.push(normalizeLog(log, 'php', opts));
    }
  }

  return logs;
}

function parseOdooLogs(text, opts = {}) {
  const logs = [];

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const m = line.match(PATTERNS.OdooLog);
    if (m) {
      const log = {
        log_level: m[1].toUpperCase(),
        message: m[3],
        service: 'odoo'
      };
      logs.push(normalizeLog(log, 'odoo', opts));
    }
  }

  return logs;
}

function parsePlainText(text, opts = {}) {
  const logs = [];

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const extractedTimestamp = extractTimestampFromText(line);
    const log = {
      timestamp: extractedTimestamp || new Date().toISOString(),
      message: line,
      log_level: inferLogLevel(line),
      service: extractNamedValue(line, ['service', 'svc', 'app']) || opts.service || 'unknown',
      source: extractNamedValue(line, ['source', 'host', 'hostname', 'server']) || opts.source || null,
      target_user: extractNamedValue(line, ['user', 'username', 'uid', 'actor', 'account', 'email']),
      module: extractNamedValue(line, ['module', 'component', 'logger'])
    };
    logs.push(normalizeLog(log, 'text', opts));
  }

  return logs;
}

// ===========================================================================================
// UTILITY FUNCTIONS
// ===========================================================================================

function extractXmlTag(content, tag) {
  const regex = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i');
  const match = content.match(regex);
  return match ? match[1] : null;
}

function getSeverityName(code) {
  const severities = ['emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug'];
  return (severities[code] || 'info').toUpperCase();
}

function inferLogLevel(text) {
  const lower = text.toLowerCase();
  for (const [level, _] of Object.entries(LOG_LEVELS)) {
    if (lower.includes(level)) return level.toUpperCase();
  }
  return 'INFO';
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractNamedValue(text, names) {
  const source = String(text || '');

  for (const name of names) {
    const re = new RegExp(
      '(?:^|[\\s,;])' + escapeRegExp(name) + '\\s*[=:]\\s*["\\\']?([^"\\\'\\s,;]+)',
      'i'
    );

    const match = source.match(re);
    if (match && match[1]) return match[1].slice(0, 255);
  }

  return null;
}

function extractTimestampFromText(text) {
  const source = String(text || '');
  const patterns = [
    // ISO 8601 avec timezone
    /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/,
    // YYYY-MM-DD HH:mm:ss (avec virgule ou point pour ms)
    /\b\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:[,.]\d+)?\b/,
    // YYYY/MM/DD HH:mm:ss
    /\b\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}\b/,
    // DD/MM/YYYY HH:mm:ss
    /\b\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}\b/,
    // DD-MM-YYYY HH:mm:ss
    /\b\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}:\d{2}\b/,
    // DD/MM/YYYY seul (sans heure)
    /\b\d{2}\/\d{2}\/\d{4}\b/,
    // YYYY-MM-DD seul
    /\b\d{4}-\d{2}-\d{2}\b/,
    // Syslog : Jan  1 14:32:11
    /\b\w{3}\s{1,2}\d{1,2}\s+\d{2}:\d{2}:\d{2}\b/,
    // UNIX timestamp (10 chiffres, en début de ligne ou après espace)
    /(?:^|\s)(\d{10})(?:\s|$)/,
    // UNIX timestamp millisecondes (13 chiffres)
    /(?:^|\s)(\d{13})(?:\s|$)/,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) return (match[1] || match[0]).trim();
  }
  return null;
}

import { enrichLogMetadata } from './logMetadata.js';

function normalizeLog(log, format, opts = {}) {
  // FIX 1d: Get locale from options
  const locale = opts.locale || process.env.LOG_DATE_LOCALE || 'fr';
  
  // AMÉLIORATION 1: Ensure complete log enrichment
  let timestamp = log.timestamp || log.time || log.datetime || extractTimestampFromText(log.message || log.msg || log.content || '');
  let timestamp_inferred = false;
  
  // Normalize timestamp to MySQL DATETIME format (YYYY-MM-DD HH:mm:ss)
  if (!timestamp || !isValidTimestamp(timestamp)) {
    timestamp = null; // Don't force "now" here
    timestamp_inferred = true;
  } else {
    timestamp = normalizeTimestamp(timestamp, locale);
    if (!timestamp) {
      timestamp = null;
      timestamp_inferred = true;
    }
  }
  
  // FIX 1c: Extend target_user extraction with more patterns
  const rawMessage = log.message || log.msg || log.content || '';
  let target_user = log.target_user || log.user || log.actor || log.by ||
                    log.username || log.account || log.uid || log.client ||
                    log.login || log.operateur || log.operator || log.performed_by ||
                    log.triggered_by || log.initiated_by || log.responsible ||
                    extractNamedValue(rawMessage, [
                      'user', 'username', 'uid', 'actor', 'account', 'email',
                      'login', 'operateur', 'operator', 'by', 'performed_by',
                      'triggered_by', 'responsible', 'author'
                    ]) || null;
  
  if (target_user && typeof target_user === 'object') {
    target_user = target_user.name || target_user.id || String(target_user);
  }
  target_user = target_user ? String(target_user).substring(0, 255) : null;
  
  // AMÉLIORATION 1: Extract module/component
  // Pattern alternatives: module=, component=, logger=, class=, service=, app=
  let module = log.module || log.component || log.logger || log.class ||
               log.app || log.application ||
               extractNamedValue(rawMessage, ['module', 'component', 'logger']) || null;
  
  if (module && typeof module === 'object') {
    module = module.name || module.id || String(module);
  }
  module = module ? String(module).substring(0, 100) : null;
  
  // Extract error_type from stack trace or message
  let error_type = log.error_type || extractErrorType(rawMessage) || null;

  const service = log.service || extractNamedValue(rawMessage, ['service', 'svc', 'app']) || opts.service || 'unknown';
  const sourceServer = log.source_server || log.host || log.hostname || log.server ||
                       log.source || extractNamedValue(rawMessage, ['source', 'host', 'hostname', 'server']) ||
                       opts.source || null;
  
  const normalized = {
    timestamp: timestamp,
    event_timestamp: timestamp,
    created_time: timestamp ? String(timestamp).slice(11, 19) : null,
    timestamp_inferred: timestamp_inferred,
    log_level: (log.log_level || log.level || log.severity || 'INFO').toUpperCase(),
    message: rawMessage || JSON.stringify(log),
    normalized_message: log.normalized_message || null,
    service,
    module: module,
    target_user: target_user,
    error_type: error_type,
    ip_address: log.ip_address || log.client_ip || log.ip || null,
    client_ip: log.client_ip || log.ip_address || log.ip || null,
    host: sourceServer,
    hostname: sourceServer,
    source_server: sourceServer,
    stack_trace: log.stack_trace || log.stacktrace || log.stack || null,
    status_code: log.status_code || log.status || null,
    duration_ms: log.duration_ms || log.duration || null,
    event_type: log.event_type || 'generic',
    log_format: format,
    parser_format: format,
    raw_log: JSON.stringify(log),
    source: log.source || sourceServer || opts.source || null,
    timezone: log.timezone || log.tz || opts.timezone || null,
    classification_confidence: log.classification_confidence || null
  };

  return enrichLogMetadata(normalized, {
    format,
    importSource: opts.source,
    importService: opts.service,
    source_type: opts.source_type,
    filename: opts.filename,
  });
}

/**
 * Validate if a string looks like a valid timestamp
 */
function isValidTimestamp(ts) {
  if (!ts) return false;
  const str = String(ts);
  // ISO 8601 or common patterns
  const patterns = [
    /^\d{4}-\d{2}-\d{2}/, // YYYY-MM-DD
    /^\d{2}\/\d{2}\/\d{4}/, // MM/DD/YYYY or DD/MM/YYYY
    /^\d{2}-\d{2}-\d{4}/, // MM-DD-YYYY
    /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/, // Day names
    /^\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}/ // Syslog format
  ];
  return patterns.some(p => p.test(str));
}

/**
 * Normalize timestamp to MySQL DATETIME format (YYYY-MM-DD HH:mm:ss)
 * @param {string} ts - timestamp brut extrait du log
 * @param {string} locale - 'fr' (DD/MM/YYYY par défaut) ou 'us' (MM/DD/YYYY)
 */
function normalizeTimestamp(ts, locale = 'fr') {
  if (!ts) return null;
  const str = String(ts).trim();
  let date;

  try {
    // UNIX timestamp 10 chiffres (secondes)
    if (/^\d{10}$/.test(str)) {
      date = new Date(parseInt(str, 10) * 1000);
    }
    // UNIX timestamp 13 chiffres (millisecondes)
    else if (/^\d{13}$/.test(str)) {
      date = new Date(parseInt(str, 10));
    }
    // ISO 8601
    else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(str)) {
      date = new Date(str);
    }
    // YYYY-MM-DD HH:mm:ss
    else if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}/.test(str)) {
      date = new Date(str.replace(' ', 'T'));
    }
    // YYYY/MM/DD HH:mm:ss
    else if (/^\d{4}\/\d{2}\/\d{2}\s\d{2}:\d{2}:\d{2}/.test(str)) {
      date = new Date(str.replace(/\//g, '-').replace(' ', 'T'));
    }
    // DD/MM/YYYY HH:mm:ss ou MM/DD/YYYY HH:mm:ss
    else if (/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2}:\d{2})/.test(str)) {
      const [, p1, p2, year, time] = str.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2}:\d{2})/);
      const [day, month] = locale === 'fr' || parseInt(p1) > 12
        ? [p1, p2]  // DD/MM
        : [p2, p1]; // MM/DD
      date = new Date(`${year}-${month}-${day}T${time}`);
    }
    // DD/MM/YYYY seul
    else if (/^(\d{2})\/(\d{2})\/(\d{4})$/.test(str)) {
      const [, p1, p2, year] = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      const [day, month] = locale === 'fr' || parseInt(p1) > 12
        ? [p1, p2]
        : [p2, p1];
      date = new Date(`${year}-${month}-${day}T00:00:00`);
    }
    // DD-MM-YYYY HH:mm:ss
    else if (/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}:\d{2}:\d{2})/.test(str)) {
      const [, p1, p2, year, time] = str.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}:\d{2}:\d{2})/);
      const [day, month] = locale === 'fr' || parseInt(p1) > 12
        ? [p1, p2]
        : [p2, p1];
      date = new Date(`${year}-${month}-${day}T${time}`);
    }
    // Syslog : "Jan  5 14:32:11"
    else if (/^\w{3}\s{1,2}\d{1,2}\s+\d{2}:\d{2}:\d{2}/.test(str)) {
      const year = new Date().getFullYear();
      date = new Date(`${year} ${str}`);
    }
    else {
      date = new Date(str);
    }

    if (!date || isNaN(date.getTime())) return null;

    // Retourner au format MySQL DATETIME : YYYY-MM-DD HH:mm:ss
    return date.toISOString().slice(0, 19).replace('T', ' ');
  } catch (_e) {
    return null;
  }
}

/**
 * Extract error type from message or stack trace
 */
function extractErrorType(message) {
  if (!message) return null;
  
  const str = String(message);
  const errorPatterns = [
    /^(\w+Error):/,
    /Error:\s+(\w+)/,
    /^(\w+Exception):/,
    /Exception:\s+(\w+)/,
    /ECONNREFUSED/,
    /ETIMEDOUT/,
    /ENOENT/,
    /ER_ACCESS_DENIED/,
    /SyntaxError/,
    /TypeError/,
    /ReferenceError/,
    /RangeError/,
  ];
  
  for (const pattern of errorPatterns) {
    const match = str.match(pattern);
    if (match) {
      return match[1] || match[0];
    }
  }
  
  return null;
}

