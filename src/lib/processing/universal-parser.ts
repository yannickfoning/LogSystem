import { detectFormat, detectFormatFromFilename, type LogFormat } from './detect-format';
import { normalizeLevel } from './levels';
import { normalizeMessage, extractErrorType, extractStackTrace } from './normalize';
import { classifyEvent, type EventType } from './classify';
import { generateFingerprint, generateErrorTitle } from './fingerprint';

export interface LogEntry {
  rawLog?: string;
  timestamp: Date;
  logLevel: string;
  source?: string;
  sourceServer?: string;
  service?: string;
  message: string;
  normalizedMessage?: string;
  eventType: EventType;
  fingerprint?: string;
  clientIp?: string;
  module?: string;
  errorType?: string;
  stackTrace?: string;
  targetUser?: string;
  parserFormat?: string;
}

function parseTxtLines(content: string): LogEntry[] {
  const lines = content.split('\n').filter(l => l.trim());
  return lines.map(line => {
    const levelMatch = line.match(/\b(DEBUG|INFO|WARN(?:ING)?|ERROR|CRITICAL|FATAL|TRACE)\b/i);
    const level = levelMatch ? normalizeLevel(levelMatch[1]) : 'INFO';
    
    const timestampMatch = line.match(/(\d{4}[-/]\d{2}[-/]\d{2}[\sT]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/);
    const timestamp = timestampMatch ? new Date(timestampMatch[1]) : new Date();
    
    const message = line.trim();
    const normalizedMsg = normalizeMessage(message);
    const errorType = extractErrorType(message);
    const stackTrace = extractStackTrace(message);
    const eventType = classifyEvent(normalizedMsg, level);
    
    return {
      rawLog: line,
      timestamp,
      logLevel: level,
      message,
      normalizedMessage: normalizedMsg,
      eventType,
      errorType: errorType || undefined,
      stackTrace: stackTrace || undefined,
      parserFormat: 'txt',
    };
  });
}

function parseJsonArray(content: string): LogEntry[] {
  try {
    const data = JSON.parse(content);
    const items = Array.isArray(data) ? data : [data];
    return items.map(item => parseJsonObject(item)).filter(Boolean) as LogEntry[];
  } catch {
    return parseTxtLines(content);
  }
}

function parseJsonObject(obj: Record<string, unknown>): LogEntry | null {
  try {
    const message = String(obj.message || obj.msg || obj.text || obj.log || JSON.stringify(obj));
    const level = normalizeLevel(String(obj.level || obj.severity || obj.logLevel || obj.log_level || 'INFO'));
    const timestamp = obj.timestamp || obj.time || obj.date || obj.created_at || obj['@timestamp']
      ? new Date(String(obj.timestamp || obj.time || obj.date || obj.created_at || obj['@timestamp']))
      : new Date();
    
    const normalizedMsg = normalizeMessage(message);
    const errorType = extractErrorType(message);
    const stackTrace = obj.stackTrace || obj.stack_trace || obj.stack || obj.trace
      ? String(obj.stackTrace || obj.stack_trace || obj.stack || obj.trace)
      : extractStackTrace(message);
    const eventType = classifyEvent(normalizedMsg, level);

    return {
      rawLog: JSON.stringify(obj),
      timestamp: isNaN(timestamp.getTime()) ? new Date() : timestamp,
      logLevel: level,
      source: obj.source ? String(obj.source) : obj.host ? String(obj.host) : undefined,
      sourceServer: obj.sourceServer ? String(obj.sourceServer) : obj.server ? String(obj.server) : undefined,
      service: obj.service ? String(obj.service) : undefined,
      message,
      normalizedMessage: normalizedMsg,
      eventType,
      clientIp: obj.clientIp ? String(obj.clientIp) : obj.ip ? String(obj.ip) : obj.remote_addr ? String(obj.remote_addr) : undefined,
      errorType: errorType || undefined,
      stackTrace: stackTrace || undefined,
      targetUser: obj.user ? String(obj.user) : obj.username ? String(obj.username) : undefined,
      parserFormat: 'json',
    };
  } catch {
    return null;
  }
}

function parseJsonlLines(content: string): LogEntry[] {
  const lines = content.split('\n').filter(l => l.trim());
  const entries: LogEntry[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      const entry = parseJsonObject(obj);
      if (entry) entries.push(entry);
    } catch {
      // Fall back to text parsing for this line
      const entries_from_text = parseTxtLines(line);
      if (entries_from_text.length > 0) entries.push(entries_from_text[0]);
    }
  }
  return entries;
}

function parseCsvContent(content: string): LogEntry[] {
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
  const entries: LogEntry[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    if (values.length === 0) continue;

    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = values[idx] || '';
    });

    const message = obj.message || obj.msg || obj.text || obj.log || lines[i];
    const level = normalizeLevel(obj.level || obj.severity || obj.log_level || 'INFO');
    const timestamp = obj.timestamp || obj.time || obj.date
      ? new Date(obj.timestamp || obj.time || obj.date)
      : new Date();
    const normalizedMsg = normalizeMessage(message);
    const eventType = classifyEvent(normalizedMsg, level);

    entries.push({
      rawLog: lines[i],
      timestamp: isNaN(timestamp.getTime()) ? new Date() : timestamp,
      logLevel: level,
      source: obj.source || obj.host || undefined,
      sourceServer: obj.source_server || obj.server || undefined,
      service: obj.service || undefined,
      message,
      normalizedMessage: normalizedMsg,
      eventType,
      clientIp: obj.client_ip || obj.ip || undefined,
      parserFormat: 'csv',
    });
  }
  return entries;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim().replace(/^["']|["']$/g, ''));
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim().replace(/^["']|["']$/g, ''));
  return values;
}

function parseXmlContent(content: string): LogEntry[] {
  // Basic XML parsing - extract log entries from common XML log formats
  const entries: LogEntry[] = [];
  const logPattern = /<log\s+[^>]*>([\s\S]*?)<\/log>|<entry\s+[^>]*>([\s\S]*?)<\/entry>|<record\s+[^>]*>([\s\S]*?)<\/record>/gi;
  let match;

  while ((match = logPattern.exec(content)) !== null) {
    const inner = match[1] || match[2] || match[3] || '';
    const getAttr = (tag: string, attr: string): string | undefined => {
      const attrPattern = new RegExp(`<${tag}[^>]*${attr}=["']([^"']*)["']`, 'i');
      const attrMatch = inner.match(attrPattern);
      return attrMatch ? attrMatch[1] : undefined;
    };
    const getText = (tag: string): string | undefined => {
      const textPattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
      const textMatch = inner.match(textPattern);
      return textMatch ? textMatch[1].trim() : undefined;
    };

    const message = getText('message') || getText('msg') || getText('text') || inner.replace(/<[^>]+>/g, '').trim();
    const level = normalizeLevel(getText('level') || getText('severity') || 'INFO');
    const timestampStr = getText('timestamp') || getText('time') || getText('date');
    const timestamp = timestampStr ? new Date(timestampStr) : new Date();
    const normalizedMsg = normalizeMessage(message);
    const eventType = classifyEvent(normalizedMsg, level);

    entries.push({
      rawLog: match[0],
      timestamp: isNaN(timestamp.getTime()) ? new Date() : timestamp,
      logLevel: level,
      source: getText('source') || getText('host') || undefined,
      service: getText('service') || undefined,
      message,
      normalizedMessage: normalizedMsg,
      eventType,
      parserFormat: 'xml',
    });
  }

  if (entries.length === 0) {
    return parseTxtLines(content);
  }

  return entries;
}

function parseSyslogContent(content: string): LogEntry[] {
  const lines = content.split('\n').filter(l => l.trim());
  return lines.map(line => {
    const levelMatch = line.match(/\b(DEBUG|INFO|WARN(?:ING)?|ERROR|CRITICAL|FATAL)\b/i);
    const level = levelMatch ? normalizeLevel(levelMatch[1]) : 'INFO';
    const timestampMatch = line.match(/(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})/);
    let timestamp = new Date();
    if (timestampMatch) {
      const now = new Date();
      const year = now.getFullYear();
      timestamp = new Date(`${year} ${timestampMatch[1]}`);
      if (isNaN(timestamp.getTime())) timestamp = new Date();
    }
    
    const message = line.trim();
    const normalizedMsg = normalizeMessage(message);
    const eventType = classifyEvent(normalizedMsg, level);
    
    // Extract source from syslog hostname
    const hostMatch = line.match(/^\S+\s+\S+\s+(\S+)/);
    
    return {
      rawLog: line,
      timestamp,
      logLevel: level,
      source: hostMatch ? hostMatch[1] : undefined,
      message,
      normalizedMessage: normalizedMsg,
      eventType,
      parserFormat: 'syslog',
    };
  });
}

export function parseLogs(content: string, filename?: string): LogEntry[] {
  let format: LogFormat | null = null;
  
  if (filename) {
    format = detectFormatFromFilename(filename);
  }
  
  if (!format || format === 'unknown') {
    format = detectFormat(content);
  }

  let entries: LogEntry[];
  switch (format) {
    case 'json':
      entries = parseJsonArray(content);
      break;
    case 'jsonl':
      entries = parseJsonlLines(content);
      break;
    case 'csv':
      entries = parseCsvContent(content);
      break;
    case 'xml':
      entries = parseXmlContent(content);
      break;
    case 'syslog':
      entries = parseSyslogContent(content);
      break;
    case 'txt':
    default:
      entries = parseTxtLines(content);
      break;
  }

  // Generate fingerprints for entries with error levels
  for (const entry of entries) {
    if (!entry.fingerprint) {
      const isError = ['ERROR', 'CRITICAL', 'FATAL'].includes(entry.logLevel);
      if (isError || entry.errorType) {
        entry.fingerprint = generateFingerprint(
          entry.normalizedMessage || entry.message,
          entry.errorType,
          entry.source,
          entry.service
        );
      }
    }
  }

  return entries;
}
