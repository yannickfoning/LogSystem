/**
 * LogSystem v6 — Unified log file parser (JSON, CSV, TXT, plain .log)
 */
import path from 'path';
import { parseLogContent, detectFormat } from './processing/universalParser.js';
import logger from '../config/logger.js';

const LEVEL_ALIASES = {
  WARN: 'WARNING',
  ERR: 'ERROR',
  CRIT: 'CRITICAL',
  DBG: 'DEBUG',
};

/**
 * Normalize log level string
 * @param {string} level
 * @returns {string}
 */
export function normalizeLevelAlias(level) {
  const u = String(level || 'INFO').toUpperCase().trim();
  return LEVEL_ALIASES[u] || u;
}

/**
 * Parse timestamp from various formats
 * @param {string|number} val
 * @param {string} [dateFormat]
 * @returns {Date}
 */
export function parseTimestamp(val, dateFormat) {
  if (val == null || val === '') return new Date();
  if (typeof val === 'number') {
    return new Date(val > 1e11 ? val : val * 1000);
  }
  const d = new Date(val);
  if (!Number.isNaN(d.getTime())) return d;
  if (dateFormat === 'unix') {
    const n = parseInt(val, 10);
    if (!Number.isNaN(n)) return new Date(n > 1e11 ? n : n * 1000);
  }
  throw new Error(`Timestamp invalide: ${val} — Formats acceptés: ISO8601, unix ms/s`);
}

/**
 * Parse log content buffer by detected format
 * @param {Buffer|string} content
 * @param {string} filename
 * @param {object} options
 * @returns {Promise<object[]>}
 */
export async function parseLogFile(content, filename, options = {}) {
  const ext = path.extname(filename || '').slice(1).toLowerCase();
  const format = options.format || detectFormat(content);
  const importTimestamp = options.importTimestamp || new Date();
  const dateFormat = options.dateFormat || 'ISO';

  let logs = [];
  if (ext === 'json' || ext === 'jsonl' || format === 'json') {
    logs = await parseJSON(content, dateFormat);
  } else if (ext === 'csv' || format === 'csv') {
    logs = await parseCSVBuffer(content, dateFormat);
  } else {
    const parsed = await parseLogContent(content, format, {
      source: options.source,
      service: options.service,
      locale: options.locale || 'fr',
    });
    logs = parsed.map((entry) => ({
      timestamp: entry.timestamp,
      level: normalizeLevelAlias(entry.log_level || 'INFO'),
      source: entry.source || entry.source_server || options.source || 'unknown',
      message: String(entry.message || '').slice(0, 5000),
      user: entry.target_user || entry.user || null,
      service: entry.service || options.service || null,
      raw: entry,
    }));
  }

  const baseName = path.basename(filename || 'unknown.log');
  const fileCreatedAt = options.fileCreatedAt || null;

  return logs.map((log) => ({
    ...log,
    log_level: normalizeLevelAlias(log.level || log.log_level || 'INFO'),
    file_name: baseName,
    file_created_at: fileCreatedAt,
    imported_at: importTimestamp,
    log_user: log.user || log.log_user || null,
    log_source: log.source || options.source || null,
  }));
}

/**
 * @param {Buffer|string} content
 * @param {string} dateFormat
 */
async function parseJSON(content, dateFormat) {
  const text = Buffer.isBuffer(content) ? content.toString('utf8') : content;
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    data = text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  }
  if (!Array.isArray(data)) data = [data];

  return data.map((entry) => {
    if (!entry.message) throw new Error(`Message vide pour log à ${entry.timestamp || '?'}`);
    return {
      timestamp: parseTimestamp(entry.timestamp || new Date(), dateFormat),
      level: normalizeLevelAlias(entry.level || entry.log_level || 'INFO'),
      source: entry.source || 'unknown',
      message: String(entry.message).slice(0, 5000),
      user: entry.user || entry.log_user || null,
      metadata: entry,
    };
  });
}

/**
 * @param {Buffer|string} content
 * @param {string} dateFormat
 */
async function parseCSVBuffer(content, dateFormat) {
  const text = Buffer.isBuffer(content) ? content.toString('utf8') : content;
  const lines = text.split('\n').filter((l) => l.trim());
  if (!lines.length) return [];

  const delimiter = detectDelimiter(lines[0]);
  const header = lines[0].split(delimiter).map((h) => h.trim().toUpperCase());
  const tsIdx = header.findIndex((h) => /TIMESTAMP|DATE|TIME/.test(h));
  const lvlIdx = header.findIndex((h) => /LEVEL|NIVEAU/.test(h));
  const srcIdx = header.findIndex((h) => /SOURCE/.test(h));
  const msgIdx = header.findIndex((h) => /MESSAGE|MSG/.test(h));
  const userIdx = header.findIndex((h) => /USER|UTILISATEUR/.test(h));

  if (tsIdx < 0 || msgIdx < 0) {
    throw new Error('Colonnes manquantes. Minimum: timestamp, level, message');
  }

  const logs = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delimiter);
    try {
      logs.push({
        timestamp: parseTimestamp(cols[tsIdx]?.trim(), dateFormat),
        level: normalizeLevelAlias(cols[lvlIdx]?.trim() || 'INFO'),
        source: (cols[srcIdx]?.trim() || 'unknown'),
        message: String(cols[msgIdx]?.trim() || '').slice(0, 5000),
        user: userIdx >= 0 ? cols[userIdx]?.trim() || null : null,
      });
    } catch (err) {
      logger.warn({ event: 'csv_row_parse_error', row: i, error: err.message }, '[PARSER]');
    }
  }
  return logs;
}

function detectDelimiter(line) {
  const candidates = [',', ';', '|', '\t'];
  let best = ',';
  let bestCount = 0;
  for (const d of candidates) {
    const count = line.split(d).length;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  if (bestCount <= 1) throw new Error('Impossible de détecter séparateur — Spécifiez manuellement');
  return best;
}

export default { parseLogFile, parseTimestamp, normalizeLevelAlias };
