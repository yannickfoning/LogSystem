/**
 * Production scenario tests — dashboard, search, alerts, RAR import
 * Runs without live DB for most cases
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

describe('Dashboard API trends logic', () => {
  it('hourly query uses imported_at for operational windows', () => {
    const src = readFileSync(path.join(root, 'routes/dashboard.js'), 'utf8');
    expect(src).toContain('OPERATIONAL_TS');
    expect(src).toContain('UPPER(log_level)');
  });

  it('top-errors enriches sample_log_id from sample logs', () => {
    const src = readFileSync(path.join(root, 'routes/dashboard.js'), 'utf8');
    expect(src).toContain('sample_log_id: r.sample_log_id || (samples[0]');
  });

  it('uses one normalized distinct source identity for dashboard and trend counts', () => {
    const src = readFileSync(path.join(root, 'routes/dashboard.js'), 'utf8');
    const usages = src.match(/COUNT\(DISTINCT \$\{SOURCE_IDENTITY_SQL\}\)/g) || [];
    expect(src).toContain('const SOURCE_IDENTITY_SQL = `LOWER(COALESCE(');
    expect(src).toContain("'application','app','java','java application'");
    expect(usages).toHaveLength(2);
  });
});

describe('Administration system status', () => {
  it('uses the existing authenticated status route and provides runtime uptime', () => {
    const adminRoute = readFileSync(path.join(root, 'routes/admin.js'), 'utf8');
    const adminPage = readFileSync(path.join(root, 'public/admin.html'), 'utf8');

    expect(adminRoute).toContain('router.get("/system/status"');
    expect(adminRoute).toContain('uptime: process.uptime()');
    expect(adminPage).toContain("api.get('/api/admin/system/status')");
    expect(adminPage).not.toContain("api.get('/api/admin/system-status')");
  });
});

describe('Top repeated errors', () => {
  it('counts matching error logs and sorts the highest occurrence count first', () => {
    const route = readFileSync(path.join(root, 'routes/dashboard/top-errors-advanced.js'), 'utf8');
    expect(route).toContain('FROM logs l');
    expect(route).toContain('COUNT(DISTINCT l.id) AS occurrence_count');
    expect(route).toContain("l.log_level IN ('ERROR', 'CRITICAL', 'FATAL')");
    expect(route).toContain("COUNT(DISTINCT l.id) >= 1");
    expect(route).toContain('HAVING ${havingFilters.join(\' AND \')}');
    expect(route).toContain('ORDER BY occurrence_count DESC, most_recent DESC');
  });

  it('shows all imported history by default and keeps the time filter optional', () => {
    const route = readFileSync(path.join(root, 'routes/dashboard/top-errors-advanced.js'), 'utf8');
    const html = readFileSync(path.join(root, 'public/dashboard.html'), 'utf8');
    expect(route).toContain("req.query.timeRange || 'all'");
    expect(route).toContain("const rangeFilter = rangeFilters[timeRange] || ''");
    expect(html).toContain('<option value="all">Toutes périodes</option>');
    expect(html).toContain("|| 'all'");
  });
});

describe('Watcher ingestion reliability', () => {
  it('retries lock conflicts and only advances offsets after committed inserts', () => {
    const watcher = readFileSync(path.join(root, 'services/watcherService.js'), 'utf8');
    const commitIndex = watcher.indexOf('await conn.commit();');
    const persistedOffsetIndex = watcher.indexOf('fileOffsets.set(filePath, currentSize);', commitIndex);

    expect(watcher).toContain('function isRetryableLockError(error)');
    expect(watcher).toContain("logger.warn({ event: 'batch_insert_retry'");
    expect(watcher).toContain('if (Number(insertResult.affectedRows) > 0) insertedEntries.push(entry)');
    expect(watcher).toContain('await upsertErrorGroupsFromLogs(conn, userId, insertedEntries, RETURN_GAP_DAYS)');
    expect(watcher).toContain('if (fs.existsSync(row.path))');
    expect(watcher).toContain("watcher.on('unlink'");
    expect(commitIndex).toBeGreaterThanOrEqual(0);
    expect(persistedOffsetIndex).toBeGreaterThan(commitIndex);
    expect(watcher).toContain('alertWorker.broadcastLogBatch(insertedEntries, { userId })');
  });
});

describe('Error group count consistency', () => {
  it('reconciles cached groups to real log occurrences and preserves resolved status on replay', () => {
    const service = readFileSync(path.join(root, 'services/errorGroupService.js'), 'utf8');
    const worker = readFileSync(path.join(root, 'workers/import-worker.js'), 'utf8');
    const importer = readFileSync(path.join(root, 'routes/import.js'), 'utf8');

    expect(service).toContain('COUNT(*) AS occurrence_count');
    expect(service).toContain('occurrence_count = VALUES(occurrence_count)');
    expect(service).toContain("IF(VALUES(last_seen) > last_seen, 'open', status)");
    expect(worker).toContain('refreshErrorGroupsForImport(pool, userId, jobId, returnGapDays)');
    expect(service).toContain('import_job_id = ?');
    expect(service).toContain('INNER JOIN');
    expect(importer).toContain('upsertErrorGroupsFromLogs(conn, userId, orderedBatch, RETURN_GAP_DAYS)');
  });

  it('routes single-log ingestion through the same handler as batch ingestion', () => {
    const route = readFileSync(path.join(root, 'routes/logs-ingestion.js'), 'utf8');
    expect(route).toContain("router.post('/ingest', handleIngestBatch)");
    expect(route).toContain('return handleIngestBatch(req, res)');
    expect(route).toContain('upsertErrorGroupsFromLogs(conn, userId, insertedLogs)');
    expect(route).not.toContain('` + scope.sql');
  });

  it('does not flag recurring log fingerprints as database duplicates in the audit', () => {
    const audit = readFileSync(path.join(root, 'scripts/audit/production-audit.js'), 'utf8');
    expect(audit).toContain('FROM error_groups');
    expect(audit).toContain('GROUP BY fingerprint, user_id HAVING cnt > 1');
    expect(audit).not.toContain('FROM logs \n      WHERE fingerprint IS NOT NULL \n      GROUP BY fingerprint HAVING cnt > 1');
  });

  it('keeps runtime logs and uploads out of the Docker build context', () => {
    const dockerignore = readFileSync(path.join(root, '.dockerignore'), 'utf8');
    expect(dockerignore).toContain('logs/');
    expect(dockerignore).toContain('uploads/');
    expect(dockerignore).toContain('.env.*');
  });
});

describe('Dashboard frontend', () => {
  it('formats date bounds with UTC calendar components', () => {
    const html = readFileSync(path.join(root, 'public/dashboard.html'), 'utf8');
    expect(html).not.toMatch(/function fmtDate\(d\)\{\s*return d\.toISOString\(\)/);
    expect(html).toContain('d.getUTCFullYear()');
    expect(html).toContain('d.getUTCMonth()');
    expect(html).toContain('d.getUTCDate()');
  });

  it('modal sample log button handler on modal-detail-body', () => {
    const html = readFileSync(path.join(root, 'public/dashboard.html'), 'utf8');
    expect(html).toContain("document.getElementById('modal-detail-body').addEventListener('click'");
    expect(html).toContain('#btn-show-sample-log');
  });

  it('error handlers use e.error fallback', () => {
    const html = readFileSync(path.join(root, 'public/dashboard.html'), 'utf8');
    expect(html).toContain('e.error || e.message');
  });

  it('trendsChart resize uses correct variable', () => {
    const html = readFileSync(path.join(root, 'public/dashboard.html'), 'utf8');
    expect(html).toContain('if (trendsChart) trendsChart.resize()');
    expect(html).not.toContain('window.trendChart');
  });
});

describe('Alert engine', () => {
  it('exports evalAllForUser', async () => {
    const mod = await import('../services/alertEngine.js');
    expect(typeof mod.evalAllForUser).toBe('function');
  });

  it('seeds global alert rules not admin-only', () => {
    const src = readFileSync(path.join(root, 'services/alertEngine.js'), 'utf8');
    expect(src).toContain('is_global = 1');
  });

  it('evalRule uses imported_at for operational windows', () => {
    const src = readFileSync(path.join(root, 'services/alertEngine.js'), 'utf8');
    expect(src).toContain("const tsCol = OPERATIONAL_TS");
    expect(src).toContain('triggerPostIngestAlerts');
  });
});

describe('Import integration', () => {
  it('calls triggerPostIngestAlerts after import', () => {
    const src = readFileSync(path.join(root, 'routes/import.js'), 'utf8');
    expect(src).toContain('triggerPostIngestAlerts');
  });

  it('tracks every uploaded job and reports the processed archive-file count', () => {
    const html = readFileSync(path.join(root, 'public/import.html'), 'utf8');
    const worker = readFileSync(path.join(root, 'workers/import-worker.js'), 'utf8');
    expect(html).toContain('Promise.all(jobIds.map(function (jobId)');
    expect(html).toContain('if (allFinished)');
    expect(html).toContain('totalFiles: jobs.reduce');
    expect(worker).toContain('for (let fileIndex = 0; fileIndex < filesToProcess.length; fileIndex++)');
    expect(worker).toContain('fileParseErrors.push');
  });

  it('offers and extracts bzip2 and xz logs in both languages', () => {
    const html = readFileSync(path.join(root, 'public/import.html'), 'utf8');
    const translations = readFileSync(path.join(root, 'public/i18n.js'), 'utf8');
    const archive = readFileSync(path.join(root, 'lib/processing/archiveHandler.js'), 'utf8');
    expect(html).toContain('"bz2", "xz"');
    expect(translations).toContain("'import.formats': 'Formats supportés : .log, .txt, .json, .jsonl, .csv, .xml, .zip, .gz, .bz2, .xz");
    expect(translations).toContain("'import.formats': 'Supported formats: .log, .txt, .json, .jsonl, .csv, .xml, .zip, .gz, .bz2, .xz");
    expect(archive).toContain("case 'bzip2':");
    expect(archive).toContain("case 'xz':");
  });
});

describe('Search API', () => {
  it('has FULLTEXT fallback via runLogsSearch', () => {
    const src = readFileSync(path.join(root, 'routes/api/search.js'), 'utf8');
    expect(src).toContain('async function runLogsSearch');
    expect(src).toContain('search_fallback');
  });

  it('keeps the FULLTEXT fallback parameter aligned after later filters', () => {
    const src = readFileSync(path.join(root, 'routes/api/search.js'), 'utf8');
    expect(src).toContain('const paramIndex = (whereClause.slice(0, matchOffset).match(/\\?/g) || []).length');
    expect(src).toContain('fbParams.splice(paramIndex, 1, ...fallback.params)');
    expect(src).toContain("DATE_FORMAT(timestamp, '%d/%m/%Y')");
  });

  it('renders result rows with a complete data-id attribute', () => {
    const html = readFileSync(path.join(root, 'public/search.html'), 'utf8');
    expect(html).toContain(`return '<tr data-id="'+r.id+'">'`);
  });

  it('error directory uses safe literal pagination values for MySQL', () => {
    const src = readFileSync(path.join(root, 'routes/api/search.js'), 'utf8');
    const route = src.slice(src.indexOf("router.get('/error-directory'"), src.indexOf("router.get('/trends'"));

    expect(route).toContain('Number.isSafeInteger(requestedLimit)');
    expect(route).toContain('Number.isSafeInteger(requestedOffset)');
    expect(route).toContain('LIMIT ${limitNum} OFFSET ${offsetNum}');
    expect(route).not.toMatch(/LIMIT\s+\?\s+OFFSET\s+\?/);
  });
});

describe('RAR archive handler', () => {
  it('loads wasm from lib/assets path', () => {
    const src = readFileSync(path.join(root, 'lib/processing/archiveHandler.js'), 'utf8');
    expect(src).toContain("'..', 'assets', 'unrar.wasm'");
  });

  it('detects RAR by magic bytes', async () => {
    const { detectArchiveType } = await import('../lib/processing/archiveHandler.js');
    const buf = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]);
    expect(detectArchiveType('test.rar', buf)).toBe('rar');
  });
});

describe('Search API fallback helpers', () => {
  it('applySearchFallback converts FULLTEXT to LIKE', async () => {
    const mod = await import('../routes/api/search.js');
    expect(mod.default).toBeDefined();
    const src = readFileSync(path.join(root, 'routes/api/search.js'), 'utf8');
    expect(src).toContain('function applySearchFallback');
    expect(src).toContain('runCountQuery');
    expect(src).toContain('runFacetQuery');
  });
});

describe('HTTP log ingestion', () => {
  it('logs-ingestion route mounted in server.js', () => {
    const src = readFileSync(path.join(root, 'server.js'), 'utf8');
    expect(src).toContain('logsIngestionRoutes');
  });

  it('ingest triggers alert eval', () => {
    const src = readFileSync(path.join(root, 'routes/logs-ingestion.js'), 'utf8');
    expect(src).toContain('triggerPostIngestAlerts');
  });
});

describe('Archive extraction', () => {
  it('extracts GZIP log file', async () => {
    const { extractArchive, filterLogFiles } = await import('../lib/processing/archiveHandler.js');
    const zlib = await import('zlib');
    const { promisify } = await import('util');
    const gzip = promisify(zlib.gzip);
    const content = '2026-01-01 10:00:00 ERROR Database connection failed\n';
    const buf = await gzip(Buffer.from(content));
    const files = await extractArchive(buf, 'app.log.gz');
    const logs = filterLogFiles(files);
    expect(logs.length).toBe(1);
    expect(logs[0].content.toString()).toContain('ERROR');
  });

  it('isArchive detects common extensions', async () => {
    const { isArchive } = await import('../lib/processing/archiveHandler.js');
    expect(isArchive('logs.zip')).toBe(true);
    expect(isArchive('logs.rar')).toBe(true);
    expect(isArchive('plain.log')).toBe(false);
  });

  it('recursively expands compressed log files found inside archives', async () => {
    const { expandArchiveEntries, detectArchiveType } = await import('../lib/processing/archiveHandler.js');
    const zlib = await import('zlib');
    const { promisify } = await import('util');
    const gzip = promisify(zlib.gzip);
    const content = Buffer.from('2026-01-01 10:00:00 ERROR nested connection failure\n');
    const files = await expandArchiveEntries([
      { filename: 'logs/nested.log.gz', content: await gzip(content) },
      { filename: 'logs/plain.log', content },
    ]);

    expect(files).toHaveLength(2);
    expect(files.map(file => file.filename)).toContain('logs/nested.log');
    expect(files.map(file => file.filename)).toContain('logs/plain.log');
    expect(files.every(file => file.content.toString().includes('ERROR'))).toBe(true);
    expect(detectArchiveType('logs/nested.log.bz2')).toBe('bzip2');
    expect(detectArchiveType('logs/nested.log.xz')).toBe('xz');
  });
});

describe('Render config', () => {
  it('has render.yaml configuration', () => {
    const yaml = readFileSync(path.join(root, 'render.yaml'), 'utf8');
    expect(yaml).toContain('type: web');
    expect(yaml).toContain('env: node');
    expect(yaml).toContain('healthCheckPath: /health');
  });

  it('seeds default recommendations on startup', () => {
    const src = readFileSync(path.join(root, 'server.js'), 'utf8');
    expect(src).toContain('ensureDefaultRecommendations');
  });
});

describe('Server module load', () => {
  it('server.js configures all API routes', () => {
    const src = readFileSync(path.join(root, 'server.js'), 'utf8');
    expect(src).toContain("app.use('/api/dashboard'");
    expect(src).toContain("app.use('/api/search'");
    expect(src).toContain("app.use('/api/import'");
  });
});
