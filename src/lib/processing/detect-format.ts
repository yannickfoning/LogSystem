export type LogFormat = 'txt' | 'json' | 'jsonl' | 'csv' | 'xml' | 'syslog' | 'unknown';

const SYSLOG_PATTERN = /^<\d+>|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}/;
const JSON_PATTERN = /^\s*[\[{]/;
const CSV_PATTERN = /^[\w\s]*,/;
const XML_PATTERN = /^\s*<\?xml|^\s*<\w+/;
const LOG_LEVEL_PATTERN = /\b(DEBUG|INFO|WARN(?:ING)?|ERROR|CRITICAL|FATAL|TRACE)\b/i;

export function detectFormat(content: string): LogFormat {
  const trimmed = content.trim();

  // Try JSON array first
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch { /* not json */ }
  }

  // Try JSONL (first line is JSON object)
  const firstLine = trimmed.split('\n')[0]?.trim() || '';
  if (firstLine.startsWith('{')) {
    try {
      JSON.parse(firstLine);
      return 'jsonl';
    } catch { /* not jsonl */ }
  }

  // XML
  if (XML_PATTERN.test(trimmed)) {
    return 'xml';
  }

  // Syslog
  if (SYSLOG_PATTERN.test(trimmed)) {
    return 'syslog';
  }

  // CSV - check for comma-delimited header-like pattern
  const lines = trimmed.split('\n').filter(l => l.trim());
  if (lines.length >= 2 && CSV_PATTERN.test(lines[0]) && CSV_PATTERN.test(lines[1])) {
    return 'csv';
  }

  // Plain text with log patterns
  if (LOG_LEVEL_PATTERN.test(trimmed)) {
    return 'txt';
  }

  // Default to txt
  return 'txt';
}

export function detectFormatFromFilename(filename: string): LogFormat | null {
  const ext = filename.toLowerCase().split('.').pop();
  switch (ext) {
    case 'json': return 'json';
    case 'jsonl': return 'jsonl';
    case 'csv': return 'csv';
    case 'xml': return 'xml';
    case 'log':
    case 'txt': return 'txt';
    default: return null;
  }
}
