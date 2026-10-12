import pool from '../../config/database.js';

const sourceFilename = 'application.log.rar';
const batchSize = 5000;
const javaLog4jPattern = '^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}:[0-9]{2}[,.][0-9]+[[:space:]]+(TRACE|DEBUG|INFO|WARN(ING)?|ERROR|FATAL|CRITICAL)[[:space:]]+\\[[^]]+\\][[:space:]]+';

async function updateRange(importJobId, afterId, throughId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `UPDATE logs
       SET source = CASE
             WHEN source IS NULL OR TRIM(source) = '' OR LOWER(TRIM(source)) IN ('unknown', 'inconnu', 'n/a', 'na', 'null', '-', 'java', 'java application')
             THEN NULLIF(LEFT(SUBSTRING_INDEX(SUBSTRING_INDEX(message, ']', 1), '[', -1), 100), '')
             ELSE source
           END,
           source_system = COALESCE(NULLIF(source_system, ''), 'Java Application'),
           log_source = CASE
             WHEN log_source IS NULL OR TRIM(log_source) = '' OR LOWER(TRIM(log_source)) IN ('unknown', 'inconnu', 'n/a', 'na', 'null', '-', 'java', 'java application')
             THEN COALESCE(NULLIF(LEFT(SUBSTRING_INDEX(SUBSTRING_INDEX(message, ']', 1), '[', -1), 100), ''), NULLIF(source_server, ''), 'Java Application')
             ELSE log_source
           END,
           service = CASE
             WHEN service IS NULL OR TRIM(service) = '' OR LOWER(TRIM(service)) IN ('unknown', 'inconnu', 'java', 'n/a', 'na', 'null', '-', 'application', 'java application')
             THEN SUBSTRING_INDEX(SUBSTRING_INDEX(SUBSTRING_INDEX(message, ']', 1), '[', -1), '.', -1)
             ELSE service
           END,
           module = CASE
             WHEN module IS NULL OR TRIM(module) = ''
             THEN LEFT(SUBSTRING_INDEX(SUBSTRING_INDEX(message, ']', 1), '[', -1), 100)
             ELSE module
           END,
           parser_format = 'java'
       WHERE import_job_id = ? AND id > ? AND id <= ? AND message REGEXP ?`,
      [importJobId, afterId, throughId, javaLog4jPattern],
    );
    await connection.commit();
    return Number(result.affectedRows) || 0;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function backfillStackFrameMetadata(importJobId) {
  const [rows] = await pool.execute(
    `SELECT id, message FROM logs
     WHERE import_job_id = ? AND parser_format = 'text'
       AND (source IS NULL OR TRIM(source) = '' OR LOWER(TRIM(source)) IN ('unknown', 'inconnu', 'n/a', 'na', 'null', '-')
         OR service IS NULL OR TRIM(service) = '' OR LOWER(TRIM(service)) IN ('unknown', 'inconnu', 'n/a', 'na', 'null', '-')
         OR module IS NULL OR TRIM(module) = '' OR LOWER(TRIM(module)) IN ('unknown', 'inconnu', 'n/a', 'na', 'null', '-'))`,
    [importJobId],
  );
  const framePattern = /(?:^|\n)\s*at\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\.[A-Za-z_$][\w$]*\s*\(/;
  let updated = 0;

  for (const row of rows) {
    const match = String(row.message || '').match(framePattern);
    if (!match) continue;
    const className = match[1].slice(0, 100);
    const serviceName = className.split('.').pop();
    const [result] = await pool.execute(
      `UPDATE logs
       SET source = CASE WHEN source IS NULL OR TRIM(source) = '' OR LOWER(TRIM(source)) IN ('unknown', 'inconnu', 'n/a', 'na', 'null', '-') THEN ? ELSE source END,
           log_source = CASE WHEN log_source IS NULL OR TRIM(log_source) = '' OR LOWER(TRIM(log_source)) IN ('unknown', 'inconnu', 'n/a', 'na', 'null', '-') THEN ? ELSE log_source END,
           module = CASE WHEN module IS NULL OR TRIM(module) = '' OR LOWER(TRIM(module)) IN ('unknown', 'inconnu', 'n/a', 'na', 'null', '-') THEN ? ELSE module END,
           service = CASE WHEN service IS NULL OR TRIM(service) = '' OR LOWER(TRIM(service)) IN ('unknown', 'inconnu', 'n/a', 'na', 'null', '-') THEN ? ELSE service END,
           source_system = COALESCE(NULLIF(source_system, ''), 'Java Application')
       WHERE id = ? AND import_job_id = ?`,
      [className, className, className, serviceName, row.id, importJobId],
    );
    updated += Number(result.affectedRows) || 0;
  }

  return updated;
}

async function main() {
  const [jobs] = await pool.execute(
    'SELECT id FROM import_jobs WHERE filename = ? ORDER BY created_at DESC LIMIT 1',
    [sourceFilename],
  );
  if (!jobs.length) throw new Error(`Import introuvable : ${sourceFilename}`);
  const importJobId = jobs[0].id;

  let updated = 0;
  const [rows] = await pool.execute(
    'SELECT id FROM logs WHERE import_job_id = ? AND message REGEXP ? ORDER BY id',
    [importJobId, javaLog4jPattern],
  );
  for (let start = 0; start < rows.length; start += batchSize) {
    const afterId = start > 0 ? Number(rows[start - 1].id) : 0;
    const throughId = Number(rows[Math.min(start + batchSize, rows.length) - 1].id);
    updated += await updateRange(importJobId, afterId, throughId);
  }
  const stackFrameUpdated = await backfillStackFrameMetadata(importJobId);

  const [summary] = await pool.query(`
    SELECT COUNT(*) AS total,
           SUM(source IS NOT NULL AND source <> '' AND LOWER(TRIM(source)) NOT IN ('unknown', 'inconnu', 'n/a', 'na', 'null', '-')) AS with_source,
           COUNT(DISTINCT NULLIF(TRIM(source), '')) AS distinct_sources,
           SUM(service IS NOT NULL AND service <> '' AND LOWER(TRIM(service)) NOT IN ('unknown', 'inconnu', 'n/a', 'na', 'null', '-')) AS with_service,
           SUM(module IS NOT NULL AND module <> '') AS with_component,
           SUM(target_user IS NOT NULL AND target_user <> '' AND LOWER(TRIM(target_user)) NOT IN ('unknown', 'inconnu', 'n/a', 'na', 'null', '-')) AS with_log_user,
           SUM(imported_by_user_id IS NOT NULL) AS with_importer
    FROM logs WHERE import_job_id = ?
  `, [importJobId]);
  console.log(JSON.stringify({ importJobId, updated, stackFrameUpdated, summary: summary[0] }));
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async error => {
    console.error('Échec du rétro-remplissage des métadonnées de logs:', error.message);
    try {
      await pool.end();
    } finally {
      process.exit(1);
    }
  });
