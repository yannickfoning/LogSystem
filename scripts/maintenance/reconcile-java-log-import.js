import fs from 'node:fs/promises';
import pool from '../../config/database.js';
import { parseLogContent } from '../../lib/processing/universalParser.js';
import { classifyLog } from '../../lib/processing/classify.js';
import { normalizeMessage } from '../../lib/processing/normalize.js';
import { generateFingerprint } from '../../lib/processing/fingerprint.js';
import { normalizeLevel } from '../../services/logLevelUtils.js';

const sourceFilename = 'application.log.rar';
const inputPath = process.argv[2];
const applyChanges = process.argv.includes('--apply');
const insertBatchSize = 500;

function formatTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 19).replace('T', ' ');
  return String(value).replace('T', ' ').slice(0, 19);
}

function extractRawLine(entry) {
  if (typeof entry.raw_log !== 'string') return String(entry.message || '');
  try {
    const parsed = JSON.parse(entry.raw_log);
    if (typeof parsed.raw_log === 'string' && parsed.raw_log) return parsed.raw_log.replace(/\r$/, '');
  } catch {
    return entry.raw_log.replace(/\r$/, '');
  }
  return String(entry.message || '').replace(/\r$/, '');
}

function rowKey(timestamp, message) {
  return `${formatTimestamp(timestamp)}\u0000${String(message || '').replace(/\r$/, '')}`;
}

function toInsertRow(entry, rawLine, job) {
  const source = entry.source || entry.source_server || job.import_source || null;
  const sourceServer = entry.source_server || entry.host || source;
  const service = entry.service || job.import_service || null;
  const message = rawLine || entry.message || '';
  const normalizedMessage = normalizeMessage(message);
  const eventType = classifyLog(message, source, service);
  const tenantUserId = job.user_id || null;

  return [
    entry.raw_log || JSON.stringify(entry),
    formatTimestamp(entry.timestamp),
    entry.created_time || null,
    entry.timezone || null,
    normalizeLevel(entry.log_level || 'INFO'),
    source,
    sourceServer,
    entry.source_system || source || null,
    service,
    message,
    normalizedMessage,
    eventType,
    generateFingerprint(service, eventType, normalizedMessage, tenantUserId),
    tenantUserId,
    'import',
    0,
    entry.ip_address || entry.client_ip || null,
    entry.module || null,
    entry.error_type || null,
    entry.stack_trace || null,
    entry.target_user || null,
    entry.parser_format || 'java',
    entry.timestamp_inferred ? 1 : 0,
    entry.classification_confidence || 0.5,
    null,
    null,
    job.user_id || null,
    job.imported_at,
    entry.source || entry.source_server || job.import_source || null,
    job.id,
  ];
}

async function main() {
  if (!inputPath) throw new Error('Usage: node reconcile-java-log-import.js <log-file> [--apply]');
  const [jobs] = await pool.execute(
    `SELECT id, user_id, import_source, import_service,
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS imported_at
     FROM import_jobs WHERE filename = ? ORDER BY created_at DESC LIMIT 1`,
    [sourceFilename],
  );
  if (!jobs.length) throw new Error(`Import introuvable : ${sourceFilename}`);
  const job = jobs[0];
  const buffer = await fs.readFile(inputPath);
  const [existingRows] = await pool.execute(
    `SELECT DATE_FORMAT(timestamp, '%Y-%m-%d %H:%i:%s') AS timestamp_key, message
     FROM logs WHERE user_id <=> ?`,
    [job.user_id],
  );
  const existingKeys = new Set(existingRows.map(row => rowKey(row.timestamp_key, row.message)));

  const stats = {
    jobId: job.id,
    fileBytes: buffer.length,
    parserEvents: 0,
    alreadyPresent: 0,
    missingEvents: 0,
    missingEventsWithActor: 0,
    missingEventsWithoutTimestamp: 0,
    inserted: 0,
    dryRun: !applyChanges,
  };
  let insertRows = [];

  const flush = async () => {
    if (!insertRows.length || !applyChanges) {
      insertRows = [];
      return;
    }
    const [result] = await pool.query(
      `INSERT IGNORE INTO logs (
        raw_log, timestamp, created_time, timezone, log_level, source, source_server, source_system, service, message, normalized_message,
        event_type, fingerprint, user_id, source_type, ingested_realtime, client_ip, module, error_type,
        stack_trace, target_user, parser_format, timestamp_inferred, classification_confidence,
        file_created_at, file_modified_at, imported_by_user_id, imported_at, log_source, import_job_id
      ) VALUES ?`,
      [insertRows],
    );
    stats.inserted += Number(result.affectedRows) || 0;
    insertRows = [];
  };

  await parseLogContent(buffer, 'java', {
    source: job.import_source || null,
    service: job.import_service || null,
    batchSize: 1000,
    onBatch: async batch => {
      for (const entry of batch) {
        stats.parserEvents++;
        const timestamp = formatTimestamp(entry.timestamp);
        if (!timestamp) {
          stats.missingEventsWithoutTimestamp++;
          continue;
        }
        const rawLine = extractRawLine(entry);
        const key = rowKey(timestamp, rawLine);
        if (existingKeys.has(key)) {
          stats.alreadyPresent++;
          continue;
        }
        stats.missingEvents++;
        if (entry.target_user) stats.missingEventsWithActor++;
        existingKeys.add(key);
        insertRows.push(toInsertRow(entry, rawLine, job));
        if (insertRows.length >= insertBatchSize) await flush();
      }
      await flush();
    },
  });

  await flush();
  console.log(JSON.stringify(stats));
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async error => {
    console.error('Échec de la réconciliation des logs Java:', error.message);
    try {
      await pool.end();
    } finally {
      process.exit(1);
    }
  });
