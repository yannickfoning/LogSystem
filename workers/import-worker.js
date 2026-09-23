import logger from '../config/logger.js';
import pool from '../config/database.js';
import { extractArchive, isArchive, mapArchiveError, filterLogFiles } from '../lib/processing/archiveHandler.js';
import { parseLogContent, detectFormat } from '../lib/processing/universalParser.js';
import { normalizeMessage } from '../lib/processing/normalize.js';
import { classifyLog } from '../lib/processing/classify.js';
import { generateFingerprint } from '../lib/processing/fingerprint.js';
import { normalizeLevel } from '../services/logLevelUtils.js';
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
      await this.updateJobStatus(jobId, 'depositing', 0, 0);

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

      for (const file of filesToProcess) {
        const detectedFormat = detectFormat(file.content);
        logger.info({ event: 'format_detected', jobId, format: detectedFormat, file: file.filename });

        try {
          const parsedLogs = await parseLogContent(file.content, detectedFormat, {
            source: source || null,
            service: service || null,
            locale: locale || 'fr',
          });

          allParsedLogs = allParsedLogs.concat(parsedLogs);
          totalLines += parsedLogs.length;

          logger.info({ event: 'file_parsed', jobId, file: file.filename, lines: parsedLogs.length });
        } catch (e) {
          logger.warn({ event: 'parsing_error', jobId, file: file.filename, error: e.message });
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
        // Déplacer vers traité même si vide
        await this.moveToTreated(filePath, uniqueFilename);
        return;
      }

      // ÉTAPE 4: DÉCOMPTE ET INDEXATION - Insérer en BD par BATCH
      await this.updateJobStatus(jobId, 'counting', 0, 0);

      await this.processLogsBatch(allParsedLogs, jobId, userId, source, service);

      // ÉTAPE 5: DÉPLACEMENT VERS TRAITÉ
      await this.moveToTreated(filePath, uniqueFilename);

      // ÉTAPE 6: Marquer comme complété
      await this.updateJobStatus(jobId, 'completed', totalLines, 0);

      logger.info({
        event: 'import_completed',
        jobId,
        totalLines,
        processedLines: totalLines,
        errorCount: 0
      });

      this.activeJobs.set(jobId, {
        status: 'completed',
        completedAt: Date.now(),
        totalLines,
        processedLines: totalLines,
        errorCount: 0
      });

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
  async processLogsBatch(logs, jobId, userId, source, service) {
    const batchSize = 500;
    let processedLines = 0;
    let errorCount = 0;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      for (let i = 0; i < logs.length; i++) {
        try {
          const logEntry = logs[i];

          // Normaliser et enrichir le log
          const normalized = {
            raw_log: logEntry.raw_log || JSON.stringify(logEntry),
            timestamp: logEntry.timestamp || new Date().toISOString().slice(0, 19).replace('T', ' '),
            created_time: logEntry.created_time || String(logEntry.timestamp || '').slice(11, 19) || null,
            timezone: logEntry.timezone || null,
            log_level: normalizeLevel(logEntry.log_level || 'INFO'),
            source: logEntry.source || source || null,
            source_server: logEntry.source_server || logEntry.host || logEntry.source || null,
            source_system: logEntry.source_system || logEntry.source || null,
            service: logEntry.service || service || null,
            message: logEntry.message || '',
            normalized_message: normalizeMessage(logEntry.message || ''),
            event_type: classifyLog(logEntry.message || '', logEntry.source || '', logEntry.service || ''),
            fingerprint: generateFingerprint(
              logEntry.service || '',
              classifyLog(logEntry.message || '', logEntry.source || '', logEntry.service || ''),
              normalizeMessage(logEntry.message || ''),
              userId
            ),
            user_id: userId,
            source_type: 'import',
            ingested_realtime: 0,
            client_ip: logEntry.ip_address || logEntry.client_ip || null,
            module: logEntry.module || null,
            error_type: logEntry.error_type || null,
            stack_trace: logEntry.stack_trace || null,
            target_user: logEntry.target_user || null,
            parser_format: logEntry.log_format || null,
            timestamp_inferred: logEntry.timestamp_inferred ? 1 : 0,
            classification_confidence: logEntry.classification_confidence || null,
            file_created_at: logEntry.file_created_at || null,
            file_modified_at: logEntry.file_modified_at || null,
            imported_by_user_id: userId,
            imported_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
            log_source: logEntry.source || source || null,
            import_job_id: jobId,
          };

          // Insérer le log
          await conn.execute(
            `INSERT INTO logs (
              raw_log, timestamp, created_time, timezone, log_level, source, source_server, source_system, service, message, normalized_message,
              event_type, fingerprint, user_id, source_type, ingested_realtime, client_ip, module, error_type,
              stack_trace, target_user, parser_format, timestamp_inferred, classification_confidence,
              file_created_at, file_modified_at, imported_by_user_id, imported_at, log_source, import_job_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              normalized.raw_log,
              normalized.timestamp,
              normalized.created_time,
              normalized.timezone,
              normalized.log_level,
              normalized.source,
              normalized.source_server,
              normalized.source_system,
              normalized.service,
              normalized.message,
              normalized.normalized_message,
              normalized.event_type,
              normalized.fingerprint,
              normalized.user_id,
              normalized.source_type,
              normalized.ingested_realtime,
              normalized.client_ip,
              normalized.module,
              normalized.error_type,
              normalized.stack_trace,
              normalized.target_user,
              normalized.parser_format,
              normalized.timestamp_inferred,
              normalized.classification_confidence,
              normalized.file_created_at,
              normalized.file_modified_at,
              normalized.imported_by_user_id,
              normalized.imported_at,
              normalized.log_source,
              normalized.import_job_id,
            ]
          );

          processedLines++;

          // Mettre à jour la progression tous les 100 lignes
          if (processedLines % 100 === 0) {
            await this.updateJobStatus(jobId, 'counting', processedLines, errorCount);

            // Commit intermédiaire pour ne pas bloquer trop longtemps
            await conn.commit();
            await conn.beginTransaction();
          }

        } catch (e) {
          errorCount++;
          logger.warn({
            event: 'log_insertion_error',
            jobId,
            lineIndex: i,
            error: e.message
          });
        }
      }

      await conn.commit();

      logger.info({
        event: 'batch_processed',
        jobId,
        processedLines,
        errorCount
      });

    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
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
  async updateJobStatus(jobId, status, processedLines, errorCount) {
    await pool.execute(
      `UPDATE import_jobs SET status = ?, processed_lines = ?, error_count = ?, updated_at = NOW()
       WHERE id = ?`,
      [status, processedLines, errorCount, jobId]
    );

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
