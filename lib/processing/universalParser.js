/**
 * Universal Log Parser for LogSystem V6
 * Supports: plain text, JSON, JSONL, CSV, XML, Syslog (RFC3164/RFC5424),
 *           Docker, Kubernetes, Apache, Nginx, Java/Log4j, Python, PHP, Odoo
 *           (including compressed variants: .gz, .bz2, .xz)
 *
 * Features:
 * - Auto-detection of format
 * - Auto-detection of encoding (UTF-8, ISO-8859-1, CP1252, etc.)
 * - Graceful fallback to plaintext
 * - Comprehensive metadata extraction
 * - Memory-efficient streaming support for 5000MB+ files
 */

import logger from '../../config/logger.js';
import iconv from 'iconv-lite';
import { convertToUtf8, detectEncoding } from './encodingDetector.js';
import { parseJavaLog4jBatch } from './javaLog4jParser.js';
import { parseJavaLog4jStream } from './javaLog4jStreamParser.js';
import { JAVA_LOG4J_PATTERN } from './javaLog4jFormat.js';

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
  // logs Java s'écrivent "AAAA-MM-JJ HH:MM:SS,mmm NIVEAU [logger] message" ou
  // "AAAA-MM-JJ HH:MM:SS,mmm [thread] NIVEAU message" (les deux ordres sont
  // courants selon le PatternLayout configuré) : on accepte les deux.
  // BUGFIX : le pattern précédent exigeait littéralement des parenthèses autour
  // des millisecondes ( ",\(\d+\)" ) — une syntaxe qui n'existe dans aucun format
  // Log4j/Logback réel, donc ce pattern ne matchait jamais rien. En pratique les
  // logs Java s'écrivent "AAAA-MM-JJ HH:MM:SS,mmm NIVEAU [logger] message" ou
  // "AAAA-MM-JJ HH:MM:SS,mmm [thread] NIVEAU message" (les deux ordres sont
  // courants selon le PatternLayout configuré) : on accepte les deux.
  javaLog4j: JAVA_LOG4J_PATTERN,
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

const LINE_STREAM_FORMATS = new Set([
  'jsonl', 'csv', 'text', 'syslog', 'docker', 'kubernetes',
  'apache', 'nginx', 'python', 'php', 'odoo',
]);

/**
 * Detect log format from buffer
 */
export function detectFormat(buffer) {
  // Format detection only uses the first ten lines. Decode a bounded sample
  // instead of converting and splitting the entire file, which can allocate
  // several times the file size for large imports.
  const sample = Buffer.isBuffer(buffer)
    ? buffer.subarray(0, 64 * 1024)
    : Buffer.from(String(buffer ?? '').slice(0, 64 * 1024));
  const text = convertToUtf8(sample);

  // JSON / JSONL heuristics based on the beginning + line structure.
  // Test expectation: "{...}\n{...}" => jsonl
  const trimmed = text.trim();
  if (!trimmed) return 'txt';
  const normalizedStart = trimmed.replace(/^\uFEFF/, '').trimStart();
  if (/^(?:<\?xml\b|<!DOCTYPE\b)/i.test(normalizedStart) ||
      (/^<[A-Z_][\w:.-]*(?:\s[^>]*)?>/i.test(normalizedStart) &&
       /<(?:log|event|entry|record)\b/i.test(normalizedStart))) return 'xml';

  // A structured header is more reliable than comma counts: a plain message
  // often contains commas, while CSV logs usually name their columns.
  if (isCsvHeaderLine(normalizedStart.split(/\r?\n/, 1)[0])) return 'csv';
  if (isConsistentCsv(normalizedStart)) return 'csv';

  // JSONL: at least two JSON objects separated by a newline
  // (common case: {"a":1}\n{"b":2})
  if (/^\{[\s\S]*\}\s*\n\s*\{/.test(trimmed)) return 'jsonl';
  if (/^\[[\s\S]*\]\s*\n\s*\[/.test(trimmed)) return 'jsonl';
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') return 'json';
  } catch (_) {
    // Continue with the line based format heuristics.
  }

  const headLines = trimmed.split('\n').slice(0, 10);

  let scores = {
    json: 0, jsonl: 0, csv: 0, xml: 0, syslog: 0, docker: 0, kubernetes: 0,
    apache: 0, nginx: 0, java: 0, python: 0, php: 0, odoo: 0, plain: 0
  };

  for (const line of headLines) {
    if (!line.trim()) continue;

    if (line.startsWith('{') && line.endsWith('}')) scores.json += 2;
    if (line.match(PATTERNS.jsonLine)) scores.jsonl += 1;

    if (/^<[A-Z_][\w:.-]*(?:\s[^>]*)?>/i.test(line.trim())) scores.xml += 3;
    if (line.includes(',')) scores.csv += 0.5;

    if (line.match(PATTERNS.syslogRfc3164) || line.match(PATTERNS.syslogRfc5424)) scores.syslog += 2;
    if (line.match(PATTERNS.dockerJson)) scores.docker += 2;
    if (line.match(PATTERNS.k8sJson)) scores.kubernetes += 2;
    if (line.match(PATTERNS.apacheCommon)) scores.apache += 2;
    if (line.match(PATTERNS.nginxAccess)) scores.nginx += 2;
    // Un log Java/Log4j "typique" a un logger/thread entre crochets (ex: "[com.foo.Bar]"
    // ou "[main]") : on ne lui donne un score fort que dans ce cas, pour ne pas
    // masquer les vrais logs Python qui ont la même structure timestamp+niveau
    // mais sans crochets.
    const javaMatch = line.match(PATTERNS.javaLog4j);
    if (javaMatch && (javaMatch.groups.thread1 || javaMatch.groups.logger)) scores.java += 3;
    else if (javaMatch) scores.java += 1;
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
  const format = detectedFormat || detectFormat(buffer);
  const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10MB
  const isReadableStream = buffer && typeof buffer.pipe === 'function';
  const isLargeFile = isReadableStream || buffer.length > LARGE_FILE_THRESHOLD;

  let text;
  try {
    // Special handling for large Java Log4j files with multi-line support
    // Use streaming parser before decoding the full buffer to avoid holding a
    // second full-size string alongside the uploaded/extracted file in memory.
    const isJavaLog4j = format === 'java';

    if (isJavaLog4j) {
      logger.info({ event: 'using_java_log4j_parser', format, isLargeFile,
        fileSize: isReadableStream ? null : buffer.length }, '[PARSER]');

      if (isLargeFile && opts.onBatch) {
        // Use streaming parser for large files with batch callback
        const result = await parseJavaLog4jStream(buffer, {
          ...opts,
          onBatch: async (batch) => {
            // Normalize each log in the batch
            const normalizedBatch = batch.map(log => normalizeLog(log, 'java', opts));
            await opts.onBatch(normalizedBatch);
          }
        });
        const sample = Buffer.isBuffer(buffer)
          ? buffer.subarray(0, 4096)
          : String(buffer ?? '').slice(0, 4096);
        const sampleText = typeof sample === 'string' ? sample : convertToUtf8(sample);
        const hasText = result.totalLogs === 0 && (isReadableStream || sampleText.trim());
        if (hasText) {
          throw new Error('Le format Java a été détecté, mais aucune entrée complète n’a été reconnue.');
        }
        return []; // Logs are processed via onBatch callback
      } else {
        text = convertToUtf8(buffer);
        // Use batch parser for smaller files or when no callback provided
        const result = parseJavaLog4jBatch(buffer, opts);

        if (result.totalLogs === 0 && text.trim()) {
          logger.warn({ event: 'java_parser_no_logs_fallback', fileSize: buffer.length }, '[PARSER]');
          return parsePlainText(text, opts);
        }

        // Convert batches to normalized logs
        const normalizedLogs = [];
        for (const batch of result.batches) {
          for (const log of batch) {
            normalizedLogs.push(normalizeLog(log, 'java', opts));
          }
        }

        return normalizedLogs;
      }
    }

    if (isReadableStream && opts.onBatch) {
      if (!LINE_STREAM_FORMATS.has(format)) {
        throw new Error(`Le traitement en flux n'est pas disponible pour le format ${format}.`);
      }
      return await parseLineReadableStream(buffer, format, opts);
    }

    text = convertToUtf8(buffer);
    
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
      case 'python': return parsePythonLogs(text, opts);
      case 'php': return parsePhpLogs(text, opts);
      case 'odoo': return parseOdooLogs(text, opts);
      default: return parsePlainText(text, opts);
    }
  } catch (e) {
    logger.warn({ event: 'parser_format_fallback', format, error: e.message }, '[PARSER]');
    if (opts.onBatch) throw e;
    if (text === undefined) text = convertToUtf8(buffer);
    return parsePlainText(text, opts);
  }
}

async function parseLineReadableStream(readable, format, opts) {
  const batchSize = Math.max(1, Number.parseInt(opts.batchSize || '500', 10) || 500);
  const lines = [];
  let csvHeader = null;
  let carry = '';
  let decoder = null;
  let firstChunk = true;
  let stripBom = true;

  const flush = async () => {
    if (lines.length === 0) return;
    const contentLines = csvHeader ? [csvHeader, ...lines] : lines;
    const parsed = await parseLogContent(Buffer.from(contentLines.join('\n')), format, {
      ...opts,
      onBatch: undefined,
    });
    if (parsed.length > 0) await opts.onBatch(parsed);
    lines.length = 0;
  };

  const acceptLine = async line => {
    if (!line.trim()) return;
    if (format === 'csv' && csvHeader === null && isCsvHeaderLine(line)) {
      csvHeader = line;
      return;
    }
    lines.push(line);
    if (lines.length >= batchSize) await flush();
  };

  for await (const chunk of readable) {
    if (firstChunk) {
      const encoding = detectEncoding(chunk).encoding || 'utf8';
      decoder = iconv.getDecoder(encoding);
      firstChunk = false;
    }

    let decoded = decoder.write(chunk);
    if (stripBom) {
      decoded = decoded.replace(/^\uFEFF/, '');
      stripBom = false;
    }
    const parts = (carry + decoded).split(/\r?\n/);
    carry = parts.pop() || '';
    for (const line of parts) await acceptLine(line);
  }

  if (decoder) carry += decoder.end();
  if (carry) await acceptLine(carry);
  await flush();
  return [];
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
  const source = String(text || '').replace(/^\uFEFF/, '');
  const firstLine = source.split(/\r?\n/, 1)[0];
  const delimiter = detectCsvDelimiter(firstLine);
  const rows = parseDelimitedRows(source, delimiter).filter(row => row.some(value => value.trim()));
  if (rows.length === 0) return [];

  const hasHeader = isCsvHeaderLine(firstLine);
  const headers = hasHeader ? rows.shift().map(normalizeCsvHeader) : null;
  const logs = [];
  for (const values of rows) {
    if (!values.some(value => value.trim())) continue;
    const log = {};
    if (headers) {
      headers.forEach((header, index) => {
        if (header) log[header] = values[index] ?? '';
      });
    } else {
      // Headerless exports conventionally use timestamp, level, message.
      log.timestamp = values[0] || '';
      log.log_level = values[1] || 'INFO';
      log.message = values.slice(2).join(delimiter);
    }
    logs.push(normalizeLog(log, 'csv', opts));
  }
  return logs;
}

function parseXmlLogs(text, opts = {}) {
  const logs = [];
  // Match a <log> record without accidentally treating its <logs> container
  // as another record.
  const logRegex = /<(log|event|entry|record)(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi;
  let match;

  while ((match = logRegex.exec(text)) !== null) {
    const content = match[2];
    const log = {
      timestamp: extractXmlTag(content, 'timestamp') || extractXmlTag(content, 'time'),
      log_level: extractXmlTag(content, 'level') || extractXmlTag(content, 'severity'),
      message: extractXmlTag(content, 'message') || content,
      service: extractXmlTag(content, 'service'),
      source: extractXmlTag(content, 'source') || extractXmlTag(content, 'source_system'),
      source_server: extractXmlTag(content, 'host') || extractXmlTag(content, 'hostname') || extractXmlTag(content, 'server'),
      target_user: extractXmlTag(content, 'target_user') || extractXmlTag(content, 'responsible_user') || extractXmlTag(content, 'user'),
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
        service: obj.service || obj.attrs?.service || 'docker',
        source: obj.source || obj.container_name || obj.attrs?.tag || opts.source || null,
        source_server: obj.host || obj.hostname || obj.attrs?.host || null,
        target_user: obj.target_user || obj.user || obj.actor || null,
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
        service: obj.service || obj.container_name || obj.metadata?.labels?.app || 'kubernetes',
        source: obj.source || obj.metadata?.namespace || obj.metadata?.name || opts.source || null,
        source_server: obj.host || obj.node_name || obj.spec?.nodeName || null,
        target_user: obj.target_user || obj.user || obj.actor || null,
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
        source: m[1],
        client_id: m[2],
        target_user: m[2] && m[2] !== '-' ? m[2] : null,
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
        source: m[1],
        client_id: m[2],
        target_user: m[2] && m[2] !== '-' ? m[2] : null,
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
      service: extractNamedValue(line, ['service', 'service_name', 'serviceName', 'svc', 'app', 'application', 'process']) || opts.service || 'unknown',
      source: extractNamedValue(line, ['source', 'source_system', 'sourceSystem', 'source_name', 'sourceName', 'host', 'hostname', 'server', 'device']) || opts.source || null,
      target_user: extractNamedValue(line, ['target_user', 'targetUser', 'responsible_user', 'responsibleUser', 'user', 'username', 'user_id', 'userId', 'uid', 'actor', 'account', 'email']),
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
  const regex = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}\\s*>`, 'i');
  const match = content.match(regex);
  if (!match) return null;
  return match[1]
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
}

const CSV_HEADER_NAMES = new Set([
  'timestamp', 'time', 'date', 'datetime', 'event_timestamp', 'log_level', 'level', 'severity',
  'message', 'msg', 'content', 'log_message', 'service', 'service_name', 'source', 'source_server',
  'hostname', 'host', 'target_user', 'user', 'username', 'error_type', 'event_type', 'module'
]);

function normalizeCsvHeader(value) {
  const header = String(value || '').trim().replace(/^\uFEFF/, '').replace(/^['"]|['"]$/g, '')
    .toLowerCase().replace(/[\s.-]+/g, '_');
  const aliases = {
    time: 'timestamp', date: 'timestamp', datetime: 'timestamp', event_timestamp: 'timestamp',
    level: 'log_level', severity: 'log_level', msg: 'message', content: 'message', log_message: 'message',
    service_name: 'service', hostname: 'source_server', host: 'source_server',
    username: 'target_user', user: 'target_user'
  };
  return aliases[header] || header;
}

function detectCsvDelimiter(line) {
  let best = ',';
  let max = 0;
  for (const delimiter of [',', ';', '\t', '|']) {
    const count = parseDelimitedRows(String(line || ''), delimiter)[0]?.length - 1 || 0;
    if (count > max) { max = count; best = delimiter; }
  }
  return best;
}

function isCsvHeaderLine(line) {
  const row = parseDelimitedRows(String(line || ''), detectCsvDelimiter(line))[0] || [];
  const names = row.map(value => normalizeCsvHeader(value));
  const recognized = names.filter(name => CSV_HEADER_NAMES.has(name));
  return recognized.length >= 2 && names.some(name => ['timestamp', 'log_level', 'message'].includes(name));
}

function isConsistentCsv(text) {
  const lines = String(text || '').split(/\r?\n/).filter(line => line.trim()).slice(0, 6);
  if (lines.length < 2) return false;
  const delimiter = detectCsvDelimiter(lines[0]);
  const first = parseDelimitedRows(lines[0], delimiter)[0] || [];
  if (first.length < 2) return false;
  const firstLooksTimestamp = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(first[0]);
  const secondLooksLikeLevel = /^(?:TRACE|DEBUG|INFO|NOTICE|WARN(?:ING)?|ERROR|CRITICAL|FATAL|SECURITY)$/i.test(first[1] || '');
  if (!firstLooksTimestamp && !secondLooksLikeLevel) return false;
  return lines.slice(1).every(line => (parseDelimitedRows(line, delimiter)[0] || []).length === first.length);
}

function parseDelimitedRows(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(field.trim()); field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field.trim()); rows.push(row); row = []; field = '';
    } else {
      field += char;
    }
  }
  if (field.length || row.length) { row.push(field.trim()); rows.push(row); }
  return rows;
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
    const key = `(?:["']?${escapeRegExp(name)}["']?)`;
    const re = new RegExp(
      `(?:^|[\\s,;{.]|\\[|\\()${key}\\s*[=:]\\s*(?:"([^"]*)"|'([^']*)'|([^\\s,;\\]}]+))`,
      'i'
    );

    const match = source.match(re);
    const value = match && (match[1] ?? match[2] ?? match[3]);
    if (value) return value.replace(/\\(["'\\])/g, '$1').slice(0, 255);
  }

  return null;
}

function extractJavaStackFrameClass(text) {
  const match = String(text || '').match(
    /(?:^|\n)\s*at\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\.[A-Za-z_$][\w$]*\s*\(/,
  );
  return match ? match[1].slice(0, 100) : null;
}

function getLogField(log, aliases) {
  if (!log || typeof log !== 'object') return null;
  const sources = [log, log.metadata, log.context, log.fields, log.labels, log.attributes, log.actor]
    .filter(value => value && typeof value === 'object' && !Array.isArray(value));
  const normalizeKey = value => String(value).toLowerCase().replace(/[^a-z0-9]/g, '');

  for (const alias of aliases) {
    const key = normalizeKey(alias);
    for (const source of sources) {
      const matchedKey = Object.keys(source).find(candidate => normalizeKey(candidate) === key);
      if (matchedKey === undefined) continue;
      const value = source[matchedKey];
      if (value === null || value === undefined || value === '') continue;
      if (typeof value === 'object') {
        const nested = value.name ?? value.display_name ?? value.hostname ?? value.value ?? value.id;
        if (nested !== null && nested !== undefined && nested !== '') return String(nested).slice(0, 255);
        continue;
      }
      return String(value).slice(0, 255);
    }
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
  const rawValue = log.message || log.msg || log.content || '';
  const rawMessage = typeof rawValue === 'string' ? rawValue : JSON.stringify(rawValue);
  const stackFrameClass = extractJavaStackFrameClass(rawMessage);
  let target_user = getLogField(log, [
    'target_user', 'responsible_user', 'responsible', 'performed_by', 'triggered_by',
    'initiated_by', 'user', 'username', 'user_name', 'user_id', 'uid', 'actor',
    'performer', 'owner', 'account', 'email', 'login', 'operateur', 'operator', 'author'
  ]) || extractNamedValue(rawMessage, [
    'target_user', 'responsible_user', 'responsible', 'performed_by', 'triggered_by',
    'targetUser', 'responsibleUser', 'initiated_by', 'user', 'username', 'user_name', 'user_id', 'userId', 'uid', 'actor',
    'performer', 'owner', 'account', 'email', 'login', 'operateur', 'operator', 'author'
  ]) || null;
  
  if (target_user && typeof target_user === 'object') {
    target_user = target_user.name || target_user.id || String(target_user);
  }
  target_user = target_user ? String(target_user).substring(0, 255) : null;
  if (target_user && (
    ['unknown', 'inconnu', 'n/a', 'na', 'null', '-', '?'].includes(target_user.trim().toLowerCase()) ||
    /^[:$][\w-]+$/.test(target_user.trim()) ||
    /^[A-Z][A-Z0-9_$]*(?:\.[A-Z][A-Z0-9_$]*)+$/.test(target_user.trim())
  )) {
    target_user = null;
  }
  
  // AMÉLIORATION 1: Extract module/component
  // Pattern alternatives: module=, component=, logger=, class=, service=, app=
  let module = log.module || log.component || log.logger || log.class ||
               log.app || log.application ||
               extractNamedValue(rawMessage, ['module', 'component', 'logger']) || stackFrameClass || null;
  
  if (module && typeof module === 'object') {
    module = module.name || module.id || String(module);
  }
  module = module ? String(module).substring(0, 100) : null;
  
  // Extract error_type from stack trace or message
  let error_type = log.error_type || extractErrorType(rawMessage) || null;
  const rawLevel = log.log_level ?? log.level ?? log.severity ?? 'INFO';
  const normalizedLevel = String(rawLevel).toUpperCase();

  const service = getLogField(log, ['service', 'service_name', 'svc', 'app', 'application', 'process', 'program', 'container']) ||
    extractNamedValue(rawMessage, ['service', 'service_name', 'serviceName', 'svc', 'app', 'application', 'process', 'program', 'container']) ||
    (stackFrameClass ? stackFrameClass.split('.').pop() : null) ||
    opts.service || 'unknown';
  const sourceServer = getLogField(log, ['source_server', 'hostname', 'host', 'server_name', 'server', 'device', 'machine', 'node']) ||
    extractNamedValue(rawMessage, ['source_server', 'hostname', 'host', 'server_name', 'server', 'device', 'machine', 'node']) || null;
  const source = getLogField(log, ['source', 'source_name', 'source_system', 'log_source', 'origin', 'platform']) ||
    extractNamedValue(rawMessage, ['source', 'source_name', 'sourceName', 'source_system', 'sourceSystem', 'log_source', 'origin', 'platform']) ||
    stackFrameClass ||
    sourceServer || opts.source || null;
  
  const normalized = {
    timestamp: timestamp,
    event_timestamp: timestamp,
    created_time: timestamp ? String(timestamp).slice(11, 19) : null,
    timestamp_inferred: timestamp_inferred,
    log_level: normalizedLevel,
    message: rawMessage.trim() || error_type || `${String(log.log_level || log.level || log.severity || 'INFO').toUpperCase()} (message absent)`,
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
    source,
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
  let str = String(ts).trim();

  // BUGFIX : de nombreux formats de logs (Log4j, Logback, logging Python...)
  // séparent les millisecondes par une virgule ("HH:MM:SS,mmm"), qui n'est pas
  // une syntaxe reconnue par le constructeur Date de JavaScript (il attend un
  // point : "HH:MM:SS.mmm"). Sans cette conversion, Date() renvoyait "Invalid
  // Date" et l'horodatage entier était perdu (timestamp_inferred=true), alors
  // même que la date était parfaitement lisible dans le log d'origine.
  str = str.replace(/(\d{2}:\d{2}:\d{2}),(\d+)/, '$1.$2');

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

