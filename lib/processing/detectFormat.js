/**
 * L-03: Auto-detection of log format (JSON, JSONL, CSV, XML, Syslog, TXT)
 * AMÉLIORATION 5: Enhanced format detection with scoring algorithm
 */

import logger from '../../config/logger.js';

export function detectFormat(buffer) {
  const head = buffer
    .slice(0, 8192)
    .toString('utf8', 0, Math.min(8192, buffer.length))
    .trim();

  if (!head) return 'txt';

  // Scoring system: format with highest score wins
  const scores = {
    json: 0,
    jsonl: 0,
    csv: 0,
    xml: 0,
    syslog_rfc5424: 0,
    syslog_rfc3164: 0,
    apache_nginx: 0,
    windows_event: 0,
    network_firewall: 0,
    txt: 1 // Default fallback
  };

  // Check for JSON/JSONL
  if (head.startsWith('{') || head.startsWith('[')) {
    scores.json += 10;
    const lines = head
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);

    if (lines.length >= 2) {
      const hasObjectBoundary = /}\s*\n\s*\{/.test(head) || /]\s*\n\s*\[/.test(head);
      if (hasObjectBoundary) scores.jsonl += 15;

      const first2 = lines.slice(0, 2);
      if (first2.length === 2 && first2[0].startsWith('{') && first2[1].startsWith('{')) {
        scores.jsonl += 10;
      }

      const first = lines.slice(0, 5);
      const looksLikeJsonPerLine = first.every(
        l => (l.startsWith('{') && l.endsWith('}')) || (l.startsWith('[') && l.endsWith(']'))
      );
      if (looksLikeJsonPerLine) scores.jsonl += 8;
    }
  }

  // Check for XML
  if (head.startsWith('<') && /<[a-zA-Z]/.test(head)) {
    scores.xml += 10;
    if (/<log[^>]*>/i.test(head)) scores.xml += 5;
  }

  // AMÉLIORATION 5: Enhanced Syslog detection
  if (/^<\d+>/.test(head)) {
    // RFC 5424: <PRI>VERSION TIMESTAMP HOSTNAME APP PROCID MSGID STRUCTURED MSG
    if (/^<\d+>1 \d{4}-\d{2}-\d{2}T/.test(head)) {
      scores.syslog_rfc5424 += 20;
    }
    // RFC 3164: <PRI>MONTH DAY TIME HOSTNAME TAG[PID]: MSG
    else if (/^<\d+>\w+ +\d+ \d+:\d+:\d+ \S+ \S+/.test(head)) {
      scores.syslog_rfc3164 += 18;
    } else {
      scores.syslog_rfc3164 += 10;
    }
  }

  // AMÉLIORATION 5: Apache/Nginx error log detection
  // [day/month/year:time zone] [module:level] [pid tid]
  if (/\[\d{1,2}\/\w{3}\/\d{4}:\d{2}:\d{2}:\d{2}/.test(head)) {
    scores.apache_nginx += 15;
    if (/\[error\]|\[warn\]|\[crit\]|\[alert\]/.test(head)) {
      scores.apache_nginx += 5;
    }
  }

  // AMÉLIORATION 5: Windows Event Log detection
  // Log Name: | Source: | Date: | Event ID: | Type:
  if (/Log Name:|Source:|Date:|Event ID:|Type:/i.test(head)) {
    scores.windows_event += 18;
    const winEventMatches = (head.match(/Log Name:|Source:|Date:|Event ID:|Type:/gi) || []).length;
    scores.windows_event += winEventMatches;
  }

  // AMÉLIORATION 5: Network/Firewall log detection
  // src= dst= proto= action= (pfsense/fortinet style)
  if (/src=\d+\.\d+\.\d+\.\d+|dst=\d+\.\d+\.\d+\.\d+/.test(head)) {
    scores.network_firewall += 15;
    if (/proto=|action=|sport=|dport=/.test(head)) {
      scores.network_firewall += 5;
    }
  }

  // Check for CSV
  const firstLine = head.split('\n')[0];
  const commaCount = (firstLine.match(/,/g) || []).length;
  if (commaCount >= 2 && firstLine.split(',').length >= 3) {
    scores.csv += 8;
  }

  // Find best match
  let bestFormat = 'txt';
  let bestScore = scores.txt;
  for (const [format, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestFormat = format;
    }
  }

  // Normalize format names to parser names
  if (bestFormat.startsWith('syslog_')) return 'syslog';
  if (bestFormat === 'apache_nginx') return 'apache_nginx';
  if (bestFormat === 'windows_event') return 'windows_event';
  if (bestFormat === 'network_firewall') return 'network_firewall';
  
  return bestFormat;
}

/**
 * Parse logs based on detected or specified format
 * AMÉLIORATION 5: Support for Apache/Nginx, Windows Event Log, Network/Firewall formats
 */
export async function parseLogsByFormat(buffer, format = null) {
  const detectedFormat = format || detectFormat(buffer);
  const content = buffer.toString('utf8');

  switch (detectedFormat) {
    case 'json':
    case 'jsonl':
      return parseJsonLogs(content);
    case 'csv':
      return parseCsvLogs(content);
    case 'xml':
      return parseXmlLogs(content);
    case 'syslog':
      return parseSyslogLogs(content);
    case 'apache_nginx':
      return parseApacheNginxLogs(content);
    case 'windows_event':
      return parseWindowsEventLog(content);
    case 'network_firewall':
      return parseNetworkFirewallLogs(content);
    case 'txt':
    default: {
      const { parseTxtContent } = await import('./parseTxt.js');
      return parseTxtContent(content);
    }
  }
}

function parseJsonLogs(content) {
  const entries = [];
  const lines = content.split('\n').filter(l => l.trim());

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      entries.push(parseJsonObject(obj));
    } catch (e) {
      logger.warn({ event: 'json_parse_invalid_line', error: e.message }, '[JSON PARSE]');
    }
  }

  return entries;
}

function parseJsonObject(obj) {
  return {
    timestamp: obj.timestamp || obj.time || obj.date || new Date().toISOString(),
    log_level: obj.level || obj.severity || 'INFO',
    source: obj.source || obj.host || obj.hostname || null,
    service: obj.service || obj.app || obj.component || obj.logger || null,
    message: obj.message || obj.msg || JSON.stringify(obj),
    client_ip: obj.client_ip || obj.ip || null,
    module: obj.module || obj.component || null,
    error_type: obj.error_type || obj.exception_type || null,
    stack_trace: obj.stack_trace || obj.stack || null,
    target_user: obj.target_user || obj.user || null
  };
}

function parseCsvLogs(content) {
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length === 0) return [];

  const entries = [];
  const header = parseCSVLine(lines[0]);

  const colIndex = {
    timestamp: header.findIndex(h => /^(timestamp|time|date)$/i.test(h)),
    level: header.findIndex(h => /^(level|severity|priority)$/i.test(h)),
    source: header.findIndex(h => /^(source|host|hostname|server)$/i.test(h)),
    service: header.findIndex(h => /^(service|app|application|component|logger)$/i.test(h)),
    message: header.findIndex(h => /^(message|msg|event|description)$/i.test(h))
  };

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    entries.push({
      timestamp: colIndex.timestamp >= 0 ? cols[colIndex.timestamp] : new Date().toISOString(),
      log_level: colIndex.level >= 0 ? cols[colIndex.level] : 'INFO',
      source: colIndex.source >= 0 ? cols[colIndex.source] : null,
      service: colIndex.service >= 0 ? cols[colIndex.service] : null,
      message: colIndex.message >= 0 ? cols[colIndex.message] : lines[i]
    });
  }

  return entries;
}

function parseCSVLine(line) {
  const result = [];
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
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

async function parseXmlLogs(content) {
  const entries = [];
  const logRegex = /<log[^>]*>(.*?)<\/log>/gs;
  let match;

  while ((match = logRegex.exec(content)) !== null) {
    const logXml = match[1];
    entries.push({
      timestamp: extractXmlTag(logXml, 'timestamp') || new Date().toISOString(),
      log_level: extractXmlTag(logXml, 'level') || 'INFO',
      source: extractXmlTag(logXml, 'source') || null,
      service: extractXmlTag(logXml, 'service') || null,
      message: extractXmlTag(logXml, 'message') || extractXmlTag(logXml, 'text') || logXml
    });
  }

  return entries;
}

function extractXmlTag(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, 's');
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

function parseSyslogLogs(content) {
  const lines = content.split('\n').filter(l => l.trim());
  const entries = [];

  for (const line of lines) {
    // Try RFC 5424 first
    const rfc5424 = /^<(\d+)>1 (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (.*)$/.exec(line);
    if (rfc5424) {
      const priority = parseInt(rfc5424[1]);
      entries.push({
        timestamp: rfc5424[2],
        log_level: priorityToLevel(priority),
        source: rfc5424[3],
        service: rfc5424[4],
        message: rfc5424[8]
      });
      continue;
    }

    // Try RFC 3164
    const rfc3164 = /^<(\d+)>(\w+ +\d+ \d+:\d+:\d+) (\S+) ([^:]+)(?: +(\d+))?: ?(.*)$/.exec(line);
    if (rfc3164) {
      const priority = parseInt(rfc3164[1]);
      entries.push({
        timestamp: rfc3164[2],
        log_level: priorityToLevel(priority),
        source: rfc3164[3],
        service: rfc3164[4],
        message: rfc3164[6]
      });
      continue;
    }

    entries.push({
      timestamp: new Date().toISOString(),
      log_level: 'INFO',
      message: line
    });
  }

  return entries;
}

function priorityToLevel(priority) {
  const severity = priority % 8;
  const levels = ['EMERG', 'ALERT', 'CRITICAL', 'ERROR', 'WARNING', 'NOTICE', 'INFO', 'DEBUG'];
  return levels[severity] || 'INFO';
}

/* AMÉLIORATION 5: Apache/Nginx error log parser */
function parseApacheNginxLogs(content) {
  const lines = content.split('\n').filter(l => l.trim());
  const entries = [];

  for (const line of lines) {
    // Apache/Nginx format: [day/mon/year:time zone] [module:level] [pid tid] message
    const match = /\[([^\]]+)\] \[([^\]]+):([^\]]+)\] \[pid (\d+)(?::tid \d+)?\] (.*)/.exec(line);
    
    if (match) {
      entries.push({
        timestamp: parseApacheDate(match[1]),
        log_level: match[3].toUpperCase(),
        source: 'apache/nginx',
        module: match[2],
        message: match[5]
      });
    } else {
      entries.push({
        timestamp: new Date().toISOString(),
        log_level: 'INFO',
        source: 'apache/nginx',
        message: line
      });
    }
  }

  return entries;
}

function parseApacheDate(dateStr) {
  // Format: 02/Jan/2024:14:30:45 +0000
  const monthMap = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12'
  };
  
  const match = /(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})/.exec(dateStr);
  if (match) {
    const [, day, month, year, hour, minute, second] = match;
    const isoDate = `${year}-${monthMap[month]}-${day}T${hour}:${minute}:${second}Z`;
    return new Date(isoDate).toISOString();
  }
  return new Date().toISOString();
}

/* AMÉLIORATION 5: Windows Event Log parser */
function parseWindowsEventLog(content) {
  const lines = content.split('\n');
  const entries = [];
  let currentEvent = {};

  for (const line of lines) {
    if (/^Log Name:/.test(line)) {
      if (Object.keys(currentEvent).length > 0) {
        entries.push(formatWindowsEvent(currentEvent));
      }
      currentEvent = { logName: line.split(':')[1].trim() };
    } else if (/^Source:/.test(line)) {
      currentEvent.source = line.split(':')[1].trim();
    } else if (/^Date:/.test(line)) {
      currentEvent.timestamp = line.split(':').slice(1).join(':').trim();
    } else if (/^Event ID:/.test(line)) {
      currentEvent.eventId = line.split(':')[1].trim();
    } else if (/^Type:/.test(line)) {
      currentEvent.type = line.split(':')[1].trim();
    } else if (/^Computer:/.test(line)) {
      currentEvent.computer = line.split(':')[1].trim();
    } else if (line.trim()) {
      currentEvent.message = (currentEvent.message || '') + ' ' + line.trim();
    }
  }

  if (Object.keys(currentEvent).length > 0) {
    entries.push(formatWindowsEvent(currentEvent));
  }

  return entries;
}

function formatWindowsEvent(event) {
  const levelMap = { Error: 'ERROR', Warning: 'WARNING', Information: 'INFO', Critical: 'CRITICAL' };
  
  return {
    timestamp: event.timestamp ? new Date(event.timestamp).toISOString() : new Date().toISOString(),
    log_level: levelMap[event.type] || 'INFO',
    source: event.source || event.computer || 'windows',
    service: event.logName || 'System',
    message: `[Event ${event.eventId}] ${(event.message || '').trim()}`
  };
}

/* AMÉLIORATION 5: Network/Firewall log parser (pfsense/fortinet style) */
function parseNetworkFirewallLogs(content) {
  const lines = content.split('\n').filter(l => l.trim());
  const entries = [];

  for (const line of lines) {
    const fields = {};
    const parts = line.split(/\s+/);

    for (const part of parts) {
      if (part.includes('=')) {
        const [key, value] = part.split('=', 2);
        fields[key] = value;
      }
    }

    const logLevel = fields.action?.toLowerCase().includes('block') ? 'WARNING' : 'INFO';

    entries.push({
      timestamp: fields.timestamp || new Date().toISOString(),
      log_level: logLevel,
      source: fields.src || null,
      message: `[${fields.action}] ${fields.src}:${fields.sport} -> ${fields.dst}:${fields.dport} proto=${fields.proto}`,
      client_ip: fields.src || null
    });
  }

  return entries;
}

export { parseJsonLogs, parseCsvLogs, parseXmlLogs, parseSyslogLogs, parseApacheNginxLogs, parseWindowsEventLog, parseNetworkFirewallLogs };
