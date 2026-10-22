const ERROR_LEVELS = ['ERROR', 'CRITICAL', 'FATAL'];

/**
 * Refresh error-group counters and dates from the source log rows.
 * The error_groups table is a cache; logs is the authoritative occurrence count.
 */
export async function upsertErrorGroupsFromLogs(conn, userId, records, returnGapDays = 7) {
  const candidates = new Map();
  for (const record of records) {
    const fingerprint = String(record.fingerprint || '').trim();
    const level = String(record.log_level || '').toUpperCase();
    if (!fingerprint || !ERROR_LEVELS.includes(level)) continue;

    if (!candidates.has(fingerprint)) {
      candidates.set(fingerprint, {
        fingerprint,
        title: String(record.message || '').slice(0, 500),
        eventType: record.event_type || null,
        sourceServer: record.source_server || null,
        service: record.service || null,
        errorType: record.error_type || null,
      });
    }
  }

  const fingerprints = [...candidates.keys()].sort();
  if (fingerprints.length === 0) return 0;

  const placeholders = fingerprints.map(() => '?').join(',');
  const [actualGroups] = await conn.query(
    `SELECT fingerprint,
       COUNT(*) AS occurrence_count,
       MIN(timestamp) AS first_seen,
       MAX(timestamp) AS last_seen,
       CASE MAX(FIELD(log_level, 'ERROR', 'CRITICAL', 'FATAL'))
         WHEN 3 THEN 'FATAL'
         WHEN 2 THEN 'CRITICAL'
         ELSE 'ERROR'
       END AS severity_max,
       MAX(event_type) AS event_type,
       MAX(source_server) AS source_server,
       MAX(service) AS service,
       MAX(error_type) AS error_type
     FROM logs
     WHERE user_id <=> ?
       AND fingerprint IN (${placeholders})
       AND log_level IN ('ERROR', 'CRITICAL', 'FATAL')
     GROUP BY fingerprint
     ORDER BY fingerprint`,
    [userId ?? null, ...fingerprints]
  );

  if (actualGroups.length === 0) return 0;

  const values = actualGroups.map(group => {
    const candidate = candidates.get(group.fingerprint) || {};
    return [
      group.fingerprint,
      candidate.title || group.error_type || group.event_type || 'Erreur inconnue',
      group.event_type || candidate.eventType,
      group.severity_max,
      Number(group.occurrence_count),
      group.first_seen,
      group.last_seen,
      group.source_server || candidate.sourceServer,
      group.service || candidate.service,
      group.error_type || candidate.errorType,
      userId ?? null,
    ];
  });
  const valuePlaceholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(',');
  const flatValues = values.flat();

  await conn.query(
    `INSERT INTO error_groups (
       fingerprint, title, event_type, severity_max, occurrence_count,
       first_seen, last_seen, source_server, service, error_type, user_id
     ) VALUES ${valuePlaceholders}
     ON DUPLICATE KEY UPDATE
       occurrence_count = VALUES(occurrence_count),
       previous_seen = IF(VALUES(last_seen) > last_seen, last_seen, previous_seen),
       return_reason = IF(
         (status = 'resolved' OR TIMESTAMPDIFF(DAY, last_seen, VALUES(last_seen)) >= ?)
         AND VALUES(last_seen) > last_seen,
         CONCAT('Erreur deja observee le ', DATE_FORMAT(first_seen, '%Y-%m-%d %H:%i:%s'),
                ', absente depuis ', TIMESTAMPDIFF(DAY, last_seen, VALUES(last_seen)),
                ' jour(s), puis reapparue le ', DATE_FORMAT(VALUES(last_seen), '%Y-%m-%d %H:%i:%s')),
         return_reason
       ),
       returned_at = IF(
         (status = 'resolved' OR TIMESTAMPDIFF(DAY, last_seen, VALUES(last_seen)) >= ?)
         AND VALUES(last_seen) > last_seen,
         VALUES(last_seen),
         returned_at
       ),
       return_count = IF(
         (status = 'resolved' OR TIMESTAMPDIFF(DAY, last_seen, VALUES(last_seen)) >= ?)
         AND VALUES(last_seen) > last_seen,
         return_count + 1,
         return_count
       ),
       status = IF(
         (status = 'resolved' OR TIMESTAMPDIFF(DAY, last_seen, VALUES(last_seen)) >= ?)
         AND VALUES(last_seen) > last_seen,
         'returned',
         IF(VALUES(last_seen) > last_seen, 'open', status)
       ),
       first_seen = VALUES(first_seen),
       last_seen = VALUES(last_seen),
       source_server = COALESCE(VALUES(source_server), source_server),
       service = COALESCE(VALUES(service), service),
       error_type = COALESCE(VALUES(error_type), error_type),
       severity_max = IF(
         FIELD(VALUES(severity_max), 'DEBUG','INFO','WARNING','ERROR','CRITICAL','FATAL') >
         FIELD(severity_max,         'DEBUG','INFO','WARNING','ERROR','CRITICAL','FATAL'),
         VALUES(severity_max),
         severity_max
       )`,
    [...flatValues, returnGapDays, returnGapDays, returnGapDays, returnGapDays]
  );

  return actualGroups.length;
}

/**
 * Refresh error groups once after an import finishes.
 *
 * Recounting every fingerprint against the full logs table for each 500-row
 * batch makes large imports progressively slower (and can leave a job looking
 * frozen). This performs the same recount for fingerprints touched by the job
 * in one database-side aggregation.
 */
export async function refreshErrorGroupsForImport(conn, userId, jobId, returnGapDays = 7) {
  const [result] = await conn.query(
    `INSERT INTO error_groups (
       fingerprint, title, event_type, severity_max, occurrence_count,
       first_seen, last_seen, source_server, service, error_type, user_id
     )
     SELECT aggregate_rows.fingerprint, aggregate_rows.title, aggregate_rows.event_type, aggregate_rows.severity_max,
       aggregate_rows.occurrence_count, aggregate_rows.first_seen, aggregate_rows.last_seen,
       aggregate_rows.source_server, aggregate_rows.service, aggregate_rows.error_type, aggregate_rows.user_id
     FROM (
       SELECT logs.fingerprint,
         MAX(LEFT(logs.message, 500)) AS title,
         MAX(logs.event_type) AS event_type,
         CASE MAX(FIELD(logs.log_level, 'ERROR', 'CRITICAL', 'FATAL'))
           WHEN 3 THEN 'FATAL'
           WHEN 2 THEN 'CRITICAL'
           ELSE 'ERROR'
         END AS severity_max,
         COUNT(*) AS occurrence_count,
         MIN(logs.timestamp) AS first_seen,
         MAX(logs.timestamp) AS last_seen,
         MAX(logs.source_server) AS source_server,
         MAX(logs.service) AS service,
         MAX(logs.error_type) AS error_type,
         MAX(logs.user_id) AS user_id
       FROM logs
       INNER JOIN (
         SELECT DISTINCT fingerprint
         FROM logs
         WHERE import_job_id = ?
           AND user_id <=> ?
           AND log_level IN ('ERROR', 'CRITICAL', 'FATAL')
       ) AS touched ON touched.fingerprint = logs.fingerprint
       WHERE logs.user_id <=> ?
         AND logs.log_level IN ('ERROR', 'CRITICAL', 'FATAL')
       GROUP BY logs.fingerprint
     ) AS aggregate_rows
     ON DUPLICATE KEY UPDATE
       occurrence_count = VALUES(occurrence_count),
       previous_seen = IF(VALUES(last_seen) > last_seen, last_seen, previous_seen),
       return_reason = IF(
         (status = 'resolved' OR TIMESTAMPDIFF(DAY, last_seen, VALUES(last_seen)) >= ?)
         AND VALUES(last_seen) > last_seen,
         CONCAT('Erreur deja observee le ', DATE_FORMAT(first_seen, '%Y-%m-%d %H:%i:%s'),
                ', absente depuis ', TIMESTAMPDIFF(DAY, last_seen, VALUES(last_seen)),
                ' jour(s), puis reapparue le ', DATE_FORMAT(VALUES(last_seen), '%Y-%m-%d %H:%i:%s')),
         return_reason
       ),
       returned_at = IF(
         (status = 'resolved' OR TIMESTAMPDIFF(DAY, last_seen, VALUES(last_seen)) >= ?)
         AND VALUES(last_seen) > last_seen,
         VALUES(last_seen),
         returned_at
       ),
       return_count = IF(
         (status = 'resolved' OR TIMESTAMPDIFF(DAY, last_seen, VALUES(last_seen)) >= ?)
         AND VALUES(last_seen) > last_seen,
         return_count + 1,
         return_count
       ),
       status = IF(
         (status = 'resolved' OR TIMESTAMPDIFF(DAY, last_seen, VALUES(last_seen)) >= ?)
         AND VALUES(last_seen) > last_seen,
         'returned',
         IF(VALUES(last_seen) > last_seen, 'open', status)
       ),
       first_seen = VALUES(first_seen),
       last_seen = VALUES(last_seen),
       source_server = COALESCE(VALUES(source_server), source_server),
       service = COALESCE(VALUES(service), service),
       error_type = COALESCE(VALUES(error_type), error_type),
       severity_max = IF(
         FIELD(VALUES(severity_max), 'DEBUG','INFO','WARNING','ERROR','CRITICAL','FATAL') >
         FIELD(severity_max,         'DEBUG','INFO','WARNING','ERROR','CRITICAL','FATAL'),
         VALUES(severity_max),
         severity_max
       )`,
    [jobId, userId ?? null, userId ?? null, returnGapDays, returnGapDays, returnGapDays, returnGapDays]
  );

  return Number(result.affectedRows) || 0;
}
