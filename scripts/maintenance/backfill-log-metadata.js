import pool from '../../config/database.js';
import { parseLogContent } from '../../lib/processing/universalParser.js';

const applyChanges = process.argv.includes('--apply');
const batchSize = 200;
const genericServices = new Set(['application', 'app', 'java application', 'java']);
const genericSources = new Set(['application', 'app', 'java application', 'java', 'unknown']);
const missingValues = ['unknown', 'inconnu', 'n/a', 'na', 'null', '-'];
const javaActorPattern = 'USER[_ -]?ID[[:space:]]*[:=]';
const fields = ['target_user', 'source', 'source_system', 'log_source', 'source_server', 'service', 'module'];

function isMissing(value) {
  if (value === null || value === undefined) return true;
  const normalized = String(value).trim().toLowerCase();
  return !normalized || missingValues.includes(normalized);
}

function isUsefulService(value) {
  return !isMissing(value) && !genericServices.has(String(value).trim().toLowerCase());
}

function isUsefulSource(value) {
  return !isMissing(value) && !genericSources.has(String(value).trim().toLowerCase());
}

function missingCondition(field) {
  const placeholders = missingValues.map(value => `'${value}'`).join(', ');
  const servicePlaceholders = field === 'service'
    ? `, ${[...genericServices].map(value => `'${value}'`).join(', ')}`
    : '';
  return `(${field} IS NULL OR TRIM(${field}) = '' OR LOWER(TRIM(${field})) IN (${placeholders}${servicePlaceholders}))`;
}

function candidateValue(field, parsed) {
  const value = field === 'source'
    ? parsed?.source || parsed?.source_system || parsed?.log_source || parsed?.source_server
    : parsed?.[field];
  if (field === 'service') return isUsefulService(value) ? String(value).trim().slice(0, 255) : null;
  if (field === 'source' || field === 'source_system' || field === 'log_source') {
    return isUsefulSource(value) ? String(value).trim().slice(0, 255) : null;
  }
  return isMissing(value) ? null : String(value).trim().slice(0, 255);
}

async function updateBatch(rows) {
  const connection = await pool.getConnection();
  let updatedRows = 0;
  try {
    await connection.beginTransaction();
    for (const row of rows) {
      const values = {};
      for (const field of fields) {
        if (!isMissing(row[field])) continue;
        const value = row.recovered[field];
        if (value) values[field] = value;
      }
      const changedFields = Object.keys(values);
      if (!changedFields.length) continue;

      const assignments = changedFields.map(field => `${field} = CASE WHEN ${missingCondition(field)} THEN ? ELSE ${field} END`);
      const params = changedFields.map(field => values[field]);
      params.push(row.id);
      const [result] = await connection.execute(
        `UPDATE logs SET ${assignments.join(', ')} WHERE id = ?`,
        params,
      );
      updatedRows += Number(result.affectedRows) || 0;
    }
    await connection.commit();
    return updatedRows;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function main() {
  const select = `
    SELECT id, message, raw_log, parser_format, target_user, source, source_system,
           log_source, source_server, service, module
    FROM logs
    WHERE (parser_format = 'text' AND (
      ${fields.map(missingCondition).join(' OR ')}
    ))
    OR (parser_format = 'java' AND ${missingCondition('target_user')}
      AND REGEXP_LIKE(LEFT(COALESCE(message, ''), 8192), ?, 'i'))
    ORDER BY id`;
  const [rows] = await pool.execute(select, [javaActorPattern]);

  const stats = {
    dryRun: !applyChanges,
    examined: rows.length,
    parseErrors: 0,
    recoverable: Object.fromEntries(fields.map(field => [field, 0])),
    rowsUpdated: 0,
  };
  let batch = [];

  for (const row of rows) {
    try {
      const parsedLogs = await parseLogContent(
        Buffer.from(row.message || ''),
        row.parser_format || 'text',
      );
      row.parsedMessage = parsedLogs[0] || null;
    } catch {
      stats.parseErrors++;
      row.parsedMessage = null;
    }

    row.parsedRaw = null;
    if (typeof row.raw_log === 'string' && row.raw_log.trim()) {
      try {
        const rawObject = JSON.parse(row.raw_log);
        if (rawObject && typeof rawObject === 'object' && !Array.isArray(rawObject)) {
          const rawLogs = await parseLogContent(Buffer.from(row.raw_log), 'json');
          row.parsedRaw = rawLogs[0] || null;
        }
      } catch {
        // `raw_log` is often a serialized text record, so non-JSON is expected.
      }
    }

    row.recovered = Object.fromEntries(fields.map(field => [
      field,
      candidateValue(field, row.parsedMessage) || candidateValue(field, row.parsedRaw),
    ]));

    let hasChanges = false;
    for (const field of fields) {
      if (isMissing(row[field]) && row.recovered[field]) {
        stats.recoverable[field]++;
        hasChanges = true;
      }
    }

    if (applyChanges && hasChanges) {
      batch.push(row);
      if (batch.length >= batchSize) {
        stats.rowsUpdated += await updateBatch(batch);
        batch = [];
      }
    }
  }

  if (applyChanges && batch.length) {
    stats.rowsUpdated += await updateBatch(batch);
  }

  console.log(JSON.stringify(stats));
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async error => {
    console.error('Échec du rétro-remplissage des métadonnées:', error.message);
    await pool.end();
    process.exit(1);
  });
