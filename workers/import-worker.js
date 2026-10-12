import logger from '../config/logger.js';
import pool from '../config/database.js';
import { extractArchive, isArchive, mapArchiveError, filterLogFiles } from '../lib/processing/archiveHandler.js';
import { parseLogContent, detectFormat } from '../lib/processing/universalParser.js';
import { parseJavaLog4jStream } from '../lib/processing/javaLog4jStreamParser.js';
import { normalizeMessage } from '../lib/processing/normalize.js';
import { classifyLog } from '../lib/processing/classify.js';
import { generateFingerprint } from '../lib/processing/fingerprint.js';
import { normalizeLevel } from '../services/logLevelUtils.js';
import { invalidateDashboard } from '../services/cacheService.js';
import { upsertErrorGroupsFromLogs } from '../services/errorGroupService.js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

// Large file threshold for streaming (10MB)
const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024;

// Répertoires de dépôt selon le cahier des charges
const UPLOAD_DEPOT_DIR = process.env.UPLOAD_DEPOT_DIR || './uploads/depot';
const UPLOAD_TRAITED_DIR = process.env.UPLOAD_TRAITED_DIR || './uploads/traité';

// Créer les répertoires au démarrage
[UPLOAD_DEPOT_DIR, UPLOAD_TRAITED_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    logger.info({ event: 'directory_created', directory: dir }, '[IMPORT-WORKER]');
  }
});

class ImportWorker {
  constructor(concurrency = 3) {
    this.queue = [];
    this.processing = 0;
    this.concurrency = concurrency;
    this.activeJobs = new Map(); // Track currently processing jobs
  }

  // Ajouter un job à la queue
  async enqueue(jobId, buffer, filename, userId, source, service, locale) {
    logger.info({ event: 'import_enqueue_called', jobId, filename, userId }, '[IMPORT-WORKER]');

    this.queue.push({
      jobId,
      buffer,
      filename,
      userId,
      source,
      service,
      locale,
      createdAt: Date.now()
    });

    this.activeJobs.set(jobId, { status: 'queued', createdAt: Date.now() });

    logger.info({
      event: 'import_queued',
      jobId,
      queue_length: this.queue.length,
      filename
    }, '[IMPORT-WORKER]');

    this.process();
  }

  // Traiter les jobs en parallèle
  async process() {
    logger.info({ event: 'worker_process_called', processing: this.processing, queue_length: this.queue.length, concurrency: this.concurrency }, '[IMPORT-WORKER]');

    while (this.processing < this.concurrency && this.queue.length > 0) {
      this.processing++;
      const job = this.queue.shift();

      logger.info({ event: 'worker_starting_job', jobId: job.jobId, filename: job.filename }, '[IMPORT-WORKER]');

      this.handleJob(job)
        .catch(e => {
          logger.error({ event: 'job_error', jobId: job.jobId, error: e.message }, '[IMPORT-WORKER]');
          this.activeJobs.set(job.jobId, { status: 'failed', error: e.message });
        })
        .finally(() => {
          this.processing--;
          this.process(); // Continue processing next jobs
        });
    }
  }

  // Traiter UN job complet avec dissociation import/décompte
  async handleJob({ jobId, buffer, filename, userId, source, service, locale }) {
    let filePath = null;
    try {
      this.activeJobs.set(jobId, { status: 'processing', startedAt: Date.now() });

      // ÉTAPE 1: DÉPÔT - Placer le fichier dans le répertoire de dépôt
      // Keep worker states within the deployed import_jobs enum. Older Docker
      // volumes may not have the optional 'depositing'/'counting' enum values.
      await this.updateJobStatus(jobId, 'processing', 0, 0);

      const uniqueFilename = `${jobId}_${filename}`;
      filePath = path.join(UPLOAD_DEPOT_DIR, uniqueFilename);

      fs.writeFileSync(filePath, buffer);
      logger.info({ event: 'file_deposited', jobId, filePath }, '[IMPORT-WORKER]');

      // ÉTAPE 2: EXTRACTION - Extraire l'archive si nécessaire
      await this.updateJobStatus(jobId, 'extracting', 0, 0);

      let filesToProcess;

      if (isArchive(filename)) {
        logger.info({ event: 'archive_extraction_start', jobId, filename, type: path.extname(filename) });

        try {
          const extracted = await extractArchive(buffer, filename);
          filesToProcess = filterLogFiles(extracted);

          if (filesToProcess.length === 0) {
            throw new Error('Aucun fichier log valide trouvé dans l\'archive');
          }

          logger.info({
            event: 'archive_extraction_success',
            jobId,
            totalExtracted: extracted.length,
            validLogs: filesToProcess.length,
            skipped: extracted.length - filesToProcess.length
          });
        } catch (error) {
          logger.error({
            event: 'archive_extraction_failed',
            jobId,
            filename,
            error: error.message,
            code: error.code
          });

          const userError = mapArchiveError(error);

          if (userError.code === 'RAR_ENCRYPTED' || userError.code === 'RAR_CORRUPT' || userError.code === 'FILE_TOO_LARGE') {
            throw userError;
          }

          logger.warn({ event: 'fallback_to_raw_processing', jobId, filename, originalError: error.message });
          filesToProcess = [{ filename, content: buffer }];
        }
      } else {
        filesToProcess = [{ filename, content: buffer }];
      }

      // ÉTAPE 3: PARSING - Parser les fichiers (séparé du décompte)
      await this.updateJobStatus(jobId, 'parsing', 0, 0);

      let allParsedLogs = [];
      let totalLines = 0;
      let streamingStats = { processedLines: 0, successfulLines: 0, skippedLines: 0, errorCount: 0 };
      let streamingStarted = false;

      for (const file of filesToProcess) {
        const detectedFormat = detectFormat(file.content);
        logger.info({ event: 'format_detected', jobId, format: detectedFormat, file: file.filename });
        const fallbackSource = source || path.basename(file.filename || filename);

        try {
          // Large Java Log4j files must go through the streaming parser. The batch
          // parser has a 100 MB ceiling and its text fallback splits stack traces
          // into unrelated events, which loses both structure and metadata.
          if (detectedFormat === 'java' && file.content.length > 10 * 1024 * 1024) {
            const parseOptions = {
              source: fallbackSource || null,
              service: service || 'java',
              locale: locale || 'fr',
              batchSize: 500,
            };
            const { totalLogs: expectedLogs } = await parseJavaLog4jStream(file.content, parseOptions);
            totalLines += expectedLogs;
            await pool.execute('UPDATE import_jobs SET total_lines = ? WHERE id = ?', [totalLines, jobId]);

            if (!streamingStarted) {
              await this.updateJobStatus(jobId, 'inserting', 0, 0);
              streamingStarted = true;
            }
            let streamedLogs = 0;
            await parseLogContent(file.content, detectedFormat, {
              ...parseOptions,
              onBatch: async batch => {
                const withMetadata = batch.map(log => ({
                  ...log,
                  source: log.source || fallbackSource || null,
                  parser_format: detectedFormat,
                  log_format: detectedFormat,
                }));
                streamedLogs += withMetadata.length;
                streamingStats = await this.processLogsBatch(
                  withMetadata, jobId, userId, source, service, streamingStats
                );
              },
            });
            if (streamedLogs !== expectedLogs) {
              throw new Error(`Java stream count mismatch: expected ${expectedLogs}, parsed ${streamedLogs}`);
            }
            logger.info({ event: 'file_stream_parsed', jobId, file: file.filename, logs: streamedLogs });
            continue;
          }

          const parsedLogs = await parseLogContent(file.content, detectedFormat, {
            source: fallbackSource || null,
            service: service || null,
            locale: locale || 'fr',
          });

          allParsedLogs = allParsedLogs.concat(parsedLogs.map(log => ({
            ...log,
            source: log.source || fallbackSource || null,
          })));
          totalLines += parsedLogs.length;

          logger.info({ event: 'file_parsed', jobId, file: file.filename, lines: parsedLogs.length });
        } catch (e) {
          logger.warn({ event: 'parsing_error', jobId, file: file.filename, error: e.message });
          if (detectedFormat === 'java' && file.content.length > 10 * 1024 * 1024) throw e;
        }
      }

      // Update total lines count
      await pool.execute(
        'UPDATE import_jobs SET total_lines = ? WHERE id = ?',
        [totalLines, jobId]
      );

      logger.info({ event: 'total_lines_parsed', jobId, totalLines });

      if (totalLines === 0) {
        await this.updateJobStatus(jobId, 'completed', 0, 0, 'No logs parsed');
        await pool.execute(
          'UPDATE import_jobs SET completed_at = NOW() WHERE id = ?',
          [jobId]
        );
        // Déplacer vers traité même si vide
        await this.moveToTreated(filePath, uniqueFilename);
        return;
      }

      // ÉTAPE 4: DÉCOMPTE ET INDEXATION - Insérer en BD par BATCH
      if (!streamingStarted) await this.updateJobStatus(jobId, 'inserting', 0, 0);
      const finalStats = allParsedLogs.length
        ? await this.processLogsBatch(allParsedLogs, jobId, userId, source, service, streamingStats)
        : streamingStats;
      const { processedLines, successfulLines, skippedLines, errorCount } = finalStats;

      // ÉTAPE 5: DÉPLACEMENT VERS TRAITÉ
      await this.moveToTreated(filePath, uniqueFilename);

      // ÉTAPE 6: Marquer comme complété
      const finalStatus = errorCount > 0 && successfulLines === 0 && skippedLines === 0
        ? 'failed'
        : 'completed';
      await this.updateJobStatus(jobId, finalStatus, processedLines, errorCount, successfulLines, skippedLines);
      await pool.execute(
        `UPDATE import_jobs SET completed_at = NOW(), error_message = ? WHERE id = ?`,
        [finalStatus === 'failed' ? 'Aucune ligne n’a pu être enregistrée.' : null, jobId]
      );

      logger.info({
        event: finalStatus === 'completed' ? 'import_completed' : 'import_failed',
        jobId,
        totalLines,
        processedLines,
        successfulLines,
        skippedLines,
        errorCount
      });

      this.activeJobs.set(jobId, {
        status: finalStatus,
        completedAt: Date.now(),
        totalLines,
        processedLines,
        successfulLines,
        skippedLines,
        errorCount
      });

      if (processedLines > 0) await invalidateDashboard(userId);

    } catch (error) {
      logger.error({ event: 'import_failed', jobId, error: error.message, code: error.code });

      let errorMessage = error.message;
      if (error.code) {
        try {
          const mappedError = mapArchiveError(error);
          errorMessage = mappedError.message;
        } catch (e) {
          // Si le mapping échoue, utiliser le message original
        }
      }

      await pool.execute(
        `UPDATE import_jobs SET status = 'failed', error_message = ?, completed_at = NOW()
         WHERE id = ?`,
        [errorMessage.substring(0, 1000), jobId]
      );

      this.activeJobs.set(jobId, {
        status: 'failed',
        error: errorMessage,
        failedAt: Date.now()
      });

      // En cas d'erreur, déplacer quand même vers traité pour nettoyer le dépôt
      if (filePath) {
        await this.moveToTreated(filePath, path.basename(filePath));
      }
    }
  }

  // Process logs in batch
  async processLogsBatch(logs, jobId, userId, source, service, initialStats = {}) {
    const batchSize = 500;
    let processedLines = Number(initialStats.processedLines) || 0;
    let successfulLines = Number(initialStats.successfulLines) || 0;
    let skippedLines = Number(initialStats.skippedLines) || 0;
    let errorCount = Number(initialStats.errorCount) || 0;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const columns = `raw_log, timestamp, created_time, timezone, log_level, source, source_server, source_system,
        service, message, normalized_message, event_type, fingerprint, user_id, source_type, ingested_realtime,
        client_ip, module, error_type, stack_trace, target_user, parser_format, timestamp_inferred,
        classification_confidence, file_created_at, file_modified_at, imported_by_user_id, imported_at,
        log_source, import_job_id`;
      const singleInsert = `INSERT IGNORE INTO logs (${columns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

      for (let start = 0; start < logs.length; start += batchSize) {
        const end = Math.min(start + batchSize, logs.length);
        const batchRows = [];

        for (let i = start; i < end; i++) {
          try {
            const logEntry = logs[i];
            const message = logEntry.message || '';
            const eventType = classifyLog(message, logEntry.source || '', logEntry.service || '');
            const normalizedMessage = normalizeMessage(message);
            const importedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');

            batchRows.push([
              logEntry.raw_log || JSON.stringify(logEntry),
              logEntry.timestamp || importedAt,
              logEntry.created_time || String(logEntry.timestamp || '').slice(11, 19) || null,
              logEntry.timezone || null,
              normalizeLevel(logEntry.log_level || 'INFO'),
              logEntry.source || source || null,
              logEntry.source_server || logEntry.host || logEntry.source || null,
              logEntry.source_system || logEntry.source || null,
              logEntry.service || service || null,
              message,
              normalizedMessage,
              eventType,
              generateFingerprint(logEntry.service || '', eventType, normalizedMessage, userId),
              userId,
              'import',
              0,
              logEntry.ip_address || logEntry.client_ip || null,
              logEntry.module || null,
              logEntry.error_type || null,
              logEntry.stack_trace || null,
              logEntry.target_user || null,
              logEntry.parser_format || logEntry.log_format || null,
              logEntry.timestamp_inferred ? 1 : 0,
              logEntry.classification_confidence || null,
              logEntry.file_created_at || null,
              logEntry.file_modified_at || null,
              userId,
              importedAt,
              logEntry.source || source || null,
              jobId,
            ]);
          } catch (e) {
            processedLines++;
            errorCount++;
            logger.warn({ event: 'log_normalization_error', jobId, lineIndex: i, error: e.message });
          }
        }

        if (batchRows.length > 0) {
          batchRows.sort((a, b) => {
            const aFingerprint = String(a[12] || '');
            const bFingerprint = String(b[12] || '');
            if (aFingerprint !== bFingerprint) return aFingerprint < bFingerprint ? -1 : 1;
            const aTimestamp = String(a[1] || '');
            const bTimestamp = String(b[1] || '');
            return aTimestamp === bTimestamp ? 0 : (aTimestamp < bTimestamp ? -1 : 1);
          });
          let insertedRows = [];
          try {
            const [insertResult] = await conn.query(`INSERT IGNORE INTO logs (${columns}) VALUES ?`, [batchRows]);
            processedLines += batchRows.length;
            successfulLines += Number(insertResult.affectedRows) || 0;
            skippedLines += batchRows.length - (Number(insertResult.affectedRows) || 0);
            insertedRows = batchRows;
          } catch (batchError) {
            logger.warn({
              event: 'log_batch_insertion_error',
              jobId,
              startIndex: start,
              endIndex: end - 1,
              batchSize: batchRows.length,
              error: batchError.message,
            });

            // Isoler les éventuelles lignes invalides sans abandonner tout le lot.
            for (let offset = 0; offset < batchRows.length; offset++) {
              try {
                const [insertResult] = await conn.execute(singleInsert, batchRows[offset]);
                processedLines++;
                if (Number(insertResult.affectedRows) > 0) successfulLines++;
                else skippedLines++;
                insertedRows.push(batchRows[offset]);
              } catch (e) {
                processedLines++;
                errorCount++;
                logger.warn({
                  event: 'log_insertion_error',
                  jobId,
                  lineIndex: start + offset,
                  error: e.message,
                });
              }
            }
          }

          await this.upsertErrorGroups(conn, insertedRows);
        }

        await this.updateJobStatus(jobId, 'inserting', processedLines, errorCount, successfulLines, skippedLines);
        await conn.commit();
        if (end < logs.length) await conn.beginTransaction();
      }

      logger.info({
        event: 'batch_processed',
        jobId,
        processedLines,
        successfulLines,
        skippedLines,
        errorCount
      });
      return { processedLines, successfulLines, skippedLines, errorCount };

    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  async upsertErrorGroups(conn, logRows) {
    const records = logRows.map(row => ({
      fingerprint: row[12],
      log_level: row[4],
      timestamp: row[1],
      message: row[9],
      event_type: row[11],
      source_server: row[6],
      service: row[8],
      error_type: row[18],
    }));
    const userId = logRows[0]?.[13] ?? null;
    const returnGapDays = Number.parseInt(process.env.ERROR_RETURN_GAP_DAYS || '7', 10);
    await upsertErrorGroupsFromLogs(conn, userId, records, returnGapDays);
  }

  // Déplacer un fichier traité vers le répertoire traité
  async moveToTreated(sourcePath, filename) {
    try {
      const destPath = path.join(UPLOAD_TRAITED_DIR, filename);

      if (fs.existsSync(sourcePath)) {
        fs.renameSync(sourcePath, destPath);
        logger.info({
          event: 'file_moved_to_treated',
          source: sourcePath,
          destination: destPath
        }, '[IMPORT-WORKER]');
      }
    } catch (error) {
      logger.error({
        event: 'file_move_failed',
        sourcePath,
        error: error.message
      }, '[IMPORT-WORKER]');
    }
  }

  // Mettre à jour le status du job
  async updateJobStatus(jobId, status, processedLines, errorCount, successfulLines = null, skippedLines = null) {
    if (successfulLines == null || skippedLines == null) {
      await pool.execute(
        `UPDATE import_jobs SET status = ?, processed_lines = ?, error_count = ?, updated_at = NOW()
         WHERE id = ?`,
        [status, processedLines, errorCount, jobId]
      );
    } else {
      await pool.execute(
        `UPDATE import_jobs SET status = ?, processed_lines = ?, successful_lines = ?, skipped_lines = ?,
         error_count = ?, updated_at = NOW() WHERE id = ?`,
        [status, processedLines, successfulLines, skippedLines, errorCount, jobId]
      );
    }

    logger.info({
      event: 'job_status_updated',
      jobId,
      status,
      processedLines,
      errorCount
    });
  }

  // Obtenir le statut d'un job
  getJobStatus(jobId) {
    return this.activeJobs.get(jobId) || { status: 'unknown' };
  }

  // Obtenir les jobs actifs
  getActiveJobs() {
    return Array.from(this.activeJobs.entries()).map(([id, data]) => ({ id, ...data }));
  }
}

// Instance singleton - garantir une seule instance
let importWorkerInstance = null;
function getImportWorkerInstance() {
  if (!importWorkerInstance) {
    importWorkerInstance = new ImportWorker(3); // Max 3 imports parallèles
  }
  return importWorkerInstance;
}

export const importWorker = getImportWorkerInstance();
