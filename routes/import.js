import { Router } from "express";
import multer from "multer";
import logger from "../config/logger.js";
import { v4 as uuidv4 } from "uuid";
import pool from "../config/database.js";
import { requireAuth, userScope } from "../middleware/auth.js";
import {
  parseLogContent,
  detectFormat,
} from "../lib/processing/universalParser.js";
import { normalizeMessage } from "../lib/processing/normalize.js";
import { classifyLog } from "../lib/processing/classify.js";
import { generateFingerprint } from "../lib/processing/fingerprint.js";
import { normalizeLevel } from "../services/logLevelUtils.js";
import { triggerPostIngestAlerts } from "../services/alertEngine.js";
import { alertWorker } from "../workers/alertWorker.js";
import { recordAudit } from "../middleware/audit.js";
import { validateBody, importUploadSchema } from "../middleware/validation.js";
import { invalidateDashboard } from "../services/cacheService.js";
import { extractArchive, isArchive, filterLogFiles, mapArchiveError, ArchiveError } from "../lib/processing/archiveHandler.js";
import { importLimiter } from "../lib/rateLimiter.js";
import { importWorker } from "../workers/import-worker.js";
import { upsertErrorGroupsFromLogs } from "../services/errorGroupService.js";
import fs from 'fs';
import path from 'path';

const router = Router();
router.use(requireAuth);
const RETURN_GAP_DAYS = parseInt(process.env.ERROR_RETURN_GAP_DAYS || "7", 10);
const UPLOAD_MAX_FILES = Math.max(1, Number.parseInt(process.env.UPLOAD_MAX_FILES || "10", 10) || 10);
const IS_RENDER = !!(process.env.RENDER || process.env.RENDER_SERVICE_NAME);
const DEFAULT_UPLOAD_MAX_SIZE = IS_RENDER ? 104857600 : 5242880000;
const UPLOAD_MAX_SIZE = Math.max(1, Number.parseInt(process.env.UPLOAD_MAX_SIZE || `${DEFAULT_UPLOAD_MAX_SIZE}`, 10) || DEFAULT_UPLOAD_MAX_SIZE);

function uploadValidationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

const upload = multer({
  // Use disk storage for better memory management with large files
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_TEMP_DIR || path.join('uploads', 'tmp'));
      // Ensure upload directory exists
      try {
        fs.mkdirSync(uploadDir, { recursive: true });
      } catch (error) {
        return cb(error);
      }
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
  }),
  limits: {
    files: UPLOAD_MAX_FILES,
    fileSize: UPLOAD_MAX_SIZE,
  },
  fileFilter: (req, file, cb) => {
    const filename = file.originalname;
    if (!filename || filename.trim().length === 0)
      return cb(uploadValidationError("Nom de fichier requis"));
    if (filename.length > 255)
      return cb(uploadValidationError("Nom de fichier trop long (max 255 caractères)"));

    const validNamePattern = /^[\p{L}\p{M}\p{N}._\-\s()]+$/u;
    if (!validNamePattern.test(filename))
      return cb(
        uploadValidationError("Nom de fichier contient des caractères non autorisés"),
      );

    const allowedMimeTypes = [
      "text/plain",
      "text/log",
      "text/csv",
      "application/csv",
      "text/xml",
      "application/xml",
      "application/json",
      "application/jsonl",
      "application/x-ndjson",
      "text/x-log",
      "application/octet-stream",
      "application/zip",
      "application/x-zip-compressed",
      "application/gzip",
      "application/x-gzip",
      "application/x-bzip2",
      "application/x-xz",
      "application/x-tar",
      "application/x-7z-compressed",
      "application/vnd.rar",
      "application/x-rar-compressed",
    ];
    if (file.mimetype && !allowedMimeTypes.includes(file.mimetype)) {
      return cb(uploadValidationError(`Type MIME non supporté: ${file.mimetype}`));
    }

    const ext = filename.split(".").pop().toLowerCase();
    const allowedExtensions = [
      "log",
      "txt",
      "json",
      "jsonl",
      "csv",
      "xml",
      "zip",
      "gz",
      "gzip",
      "tar",
      "tgz",
      "7z",
      "rar",
      "bz2",
      "xz",
      "log.gz",
      "log.bz2",
      "log.xz",
      "txt.gz",
      "txt.bz2",
      "txt.xz",
      "json.gz",
      "json.bz2",
      "json.xz",
      "csv.gz",
      "csv.bz2",
      "csv.xz",
    ];

    if (!allowedExtensions.includes(ext)) {
      return cb(
        uploadValidationError(
          `Extension non supportée. Utilisez: ${allowedExtensions.join(", ")}`,
        ),
      );
    }

    cb(null, true);
  },
});

// Ordre de sévérité pour error_groups (réservé pour usage futur)
/*
const SEV_ORDER = {
  DEBUG: 0,
  INFO: 1,
  WARNING: 2,
  ERROR: 3,
  CRITICAL: 4,
  FATAL: 5,
};
*/

async function processImport(
  jobId,
  filePath,
  filename,
  userId,
  source,
  service,
  locale,
) {
  // normalize variable scopes to avoid temporal dead zone
  const importSource = source ?? null;
  const importService = service ?? null;
  const dateLocale = locale || process.env.LOG_DATE_LOCALE || "fr"; // FIX 2a
  const batchSize = Math.min(
    parseInt(process.env.IMPORT_BATCH_SIZE || "1000", 10),
    2000,
  );
  const importTimestamp = new Date().toISOString().slice(0, 19).replace("T", " ");
  const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10MB

  // Read file content from disk
  let buffer;
  let fileSize = 0;
  try {
    const stats = fs.statSync(filePath);
    fileSize = stats.size;
    buffer = fs.readFileSync(filePath);
  } catch (error) {
    logger.error({ event: 'file_read_error', path: filePath, error: error.message }, '[IMPORT]');
    throw new Error(`Failed to read uploaded file: ${error.message}`);
  }

  const isLargeFile = fileSize > LARGE_FILE_THRESHOLD;
  logger.info({ event: 'file_loaded', filename, fileSize, isLargeFile, jobId }, '[IMPORT]');

  let filesToProcess;
  if (isArchive(filename)) {
    logger.info({ event: "archive_detected", file: filename }, "[IMPORT]");
    try {
      const extracted = await extractArchive(buffer, filename);
      filesToProcess = filterLogFiles(extracted);
      if (filesToProcess.length === 0) {
        throw new ArchiveError(
          "NO_LOG_FILES",
          422,
          "Aucun fichier log (.log,.txt,.json,.csv) trouvé dans l'archive.",
        );
      }
      logger.info(
        { event: "archive_extracted", count: filesToProcess.length },
        "[IMPORT]",
      );
    } catch (e) {
      logger.error(
        { event: "archive_extraction_error", error: e.message, code: e.code },
        "[IMPORT]",
      );
      throw e instanceof ArchiveError ? e : mapArchiveError(e);
    }
  } else {
    filesToProcess = [{ filename, content: buffer }];
  }

  let allParsedLogs = [];
  let streamingParsed = false;
  let parsedLogs = [];

  for (const file of filesToProcess) {
    const detectedFormat = detectFormat(file.content);
    const isLargeContent = file.content.length > LARGE_FILE_THRESHOLD;
    logger.info(
      { event: "format_detected", format: detectedFormat, file: file.filename, isLargeContent },
      "[IMPORT]",
    );

    // Use streaming for large files
    if (isLargeContent) {
      streamingParsed = true;
      logger.info({ event: "using_streaming_parser", file: file.filename }, "[IMPORT]");

      try {
        await parseLogContent(file.content, detectedFormat, {
          source: importSource,
          service: importService,
          locale: dateLocale,
          onBatch: async (batch) => {
            // Process batch directly without storing all logs in memory
            await processLogBatch(batch, jobId, userId, importSource, importService, importTimestamp, conn, batchSize);
          }
        });
      } catch (e) {
        logger.error(
          { event: "streaming_parsing_error", format: detectedFormat, error: e.message },
          "[IMPORT]",
        );
        throw e;
      }
    } else {
      // Use regular parsing for smaller files
      let fileParsedLogs;
      try {
        fileParsedLogs = await parseLogContent(file.content, detectedFormat, {
          source: importSource,
          service: importService,
          locale: dateLocale,
        });
      } catch (e) {
        logger.error(
          { event: "parsing_error", format: detectedFormat, error: e.message },
          "[IMPORT]",
        );
        fileParsedLogs = [];
      }
      // Pas de copie/concat (fichiers de plusieurs centaines de Mo = centaines de
      // milliers d'entrées) : on annote sur place puis on ajoute par lots.
      for (let k = 0; k < fileParsedLogs.length; k++) {
        const log = fileParsedLogs[k];
        log.file_created_at = file.file_created_at || null;
        log.file_modified_at = file.file_modified_at || null;
        allParsedLogs.push(log);
      }
      fileParsedLogs = null;
    }
  }

  // Process non-streamed logs normally
  let total = 0;
  if (!streamingParsed) {
    parsedLogs = allParsedLogs;
    total = parsedLogs.length;
    logger.info({ event: "lines_parsed", count: total, jobId }, "[IMPORT]");
  } else {
    // For streaming, we'll track total via the job status
    total = 0; // Will be updated during streaming
  }

  // AMÉLIORATION 1: Track import summary stats
  const importSummary = {
    total: total,
    inserted: 0,
    skipped: 0,
    missing_user: 0,
    missing_module: 0,
    missing_timestamp: 0,
    timestamp_inferred_count: 0,
    errors: 0,
  };

  const conn = await pool.getConnection();
  try {
    // Initialize import summary for streaming
    const importSummary = {
      total: 0,
      inserted: 0,
      skipped: 0,
      missing_user: 0,
      missing_module: 0,
      missing_timestamp: 0,
      timestamp_inferred_count: 0,
      errors: 0,
    };

    await conn.execute(
      "UPDATE import_jobs SET status = ?, total_lines = ?, started_at = NOW() WHERE id = ?",
      ["processing", total || 0, jobId],
    );

    if (!streamingParsed && total === 0) {
      await conn.execute(
        "UPDATE import_jobs SET status = ?, error_message = ?, completed_at = NOW() WHERE id = ?",
        [
          "failed",
          "Aucune ligne parsée — vérifiez le format du fichier",
          jobId,
        ],
      );
      conn.release();
      return;
    }

    let processed = 0;
    let errors = 0;

    if (!streamingParsed) {
      // Process non-streamed logs normally
      let batch = [];

      for (let i = 0; i < allParsedLogs.length; i++) {
        try {
          const logEntry = allParsedLogs[i];

          // AMÉLIORATION 1: Validate required fields
          // timestamp is guaranteed by normalizeLog, but check it's valid
          if (!logEntry.timestamp) {
            importSummary.missing_timestamp++;
            importSummary.skipped++;
            continue;
          }

          // Validate and warn about missing user/module
          if (!logEntry.target_user) {
            importSummary.missing_user++;
            // Don't skip — allow null target_user
          }

          if (logEntry.timestamp_inferred) {
            importSummary.timestamp_inferred_count++;
          }

          if (!logEntry.module) {
            importSummary.missing_module++;
            // Don't skip — allow null module
          }

          // Validate log_level and message exist
          if (!logEntry.log_level) {
            logEntry.log_level = "INFO";
          }
          if (!logEntry.message) {
            importSummary.skipped++;
            continue;
          }

          // FIX: uniquement les colonnes qui existent dans le schéma SQL
          const normalized = {
            raw_log: logEntry.raw_log || JSON.stringify(logEntry),
            timestamp:
              logEntry.timestamp ||
              new Date().toISOString().slice(0, 19).replace("T", " "),
            created_time:
              logEntry.created_time ||
              String(logEntry.timestamp || "").slice(11, 19) ||
              null,
            timezone: logEntry.timezone || null,
            log_level: normalizeLevel(logEntry.log_level || "INFO"),
            source:
              logEntry.source || logEntry.source_server || importSource || null,
            source_server:
              logEntry.source_server ||
              logEntry.host ||
              logEntry.source ||
              importSource ||
              null,
            source_system:
              logEntry.source_system ||
              logEntry.source ||
              logEntry.source_server ||
              importSource ||
              null,
            service: logEntry.service || importService || null,
            message: logEntry.message || "",
            client_ip: logEntry.ip_address || logEntry.client_ip || null, // FIX: ip_address → client_ip
            module: logEntry.module || null,
            error_type: logEntry.error_type || null,
            stack_trace: logEntry.stack_trace || null,
            target_user: logEntry.target_user || null,
            parser_format: logEntry.log_format || null,
            timestamp_inferred: logEntry.timestamp_inferred ? 1 : 0,
            classification_confidence: logEntry.classification_confidence || null,
            source_type: 'import',
            ingested_realtime: 0,
            file_created_at: logEntry.file_created_at || null,
            file_modified_at: logEntry.file_modified_at || null,
            import_job_id: jobId,
            imported_by_user_id: userId,
            imported_at: importTimestamp,
            log_source: logEntry.source || logEntry.source_server || importSource || null,
          };

          normalized.normalized_message = normalizeMessage(normalized.message);
          normalized.event_type = classifyLog(
            normalized.message,
            normalized.source,
            normalized.service,
          );
          normalized.fingerprint = generateFingerprint(
            normalized.service,
            normalized.event_type,
            normalized.normalized_message,
            userId,
          );

          batch.push(normalized);

          if (batch.length >= batchSize) {
            const insertedBatch = batch;
            await insertBatch(conn, batch, userId);
            processed += batch.length;
            importSummary.inserted += batch.length;
            alertWorker.broadcastLogBatch(insertedBatch, { userId, jobId });
            batch = [];
            await conn.execute(
              "UPDATE import_jobs SET processed_lines = ?, error_count = ? WHERE id = ?",
              [processed, errors, jobId],
            );
          }
        } catch (e) {
          errors++;
          importSummary.errors++;
          logger.error(
            { event: "processing_error", lineIndex: i, jobId, error: e.message },
            "[IMPORT]",
          );
        }
      }

      if (batch.length > 0) {
        const insertedBatch = batch;
        await insertBatch(conn, batch, userId);
        processed += batch.length;
        importSummary.inserted += batch.length;
        alertWorker.broadcastLogBatch(insertedBatch, { userId, jobId });
      }
    }

    // FIX 2c: Store import_summary for later retrieval
    await conn.execute(
      "UPDATE import_jobs SET status = ?, processed_lines = ?, error_count = ?, skipped_lines = ?, successful_lines = ?, import_summary = ?, completed_at = NOW() WHERE id = ?",
      [
        "completed",
        processed,
        errors,
        importSummary.skipped || 0,
        importSummary.inserted || processed,
        JSON.stringify(importSummary),
        jobId,
      ],
    );

    logger.info(
      { event: "import_completed", jobId, summary: importSummary },
      "[IMPORT]",
    );

    if (userId && processed > 0) {
      await triggerPostIngestAlerts(userId, processed, importSummary);
      await invalidateDashboard(userId);
    }
  } catch (e) {
    logger.error(
      { event: "import_failed", jobId, error: e.message },
      "[IMPORT]",
    );
    await conn.execute(
      "UPDATE import_jobs SET status = ?, error_message = ?, completed_at = NOW() WHERE id = ?",
      ["failed", e.message.substring(0, 1000), jobId],
    );
  } finally {
    conn.release();

    // Clean up temporary file
    try {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        logger.info({ event: 'temp_file_cleaned', path: filePath }, '[IMPORT]');
      }
    } catch (error) {
      logger.warn({ event: 'temp_file_cleanup_error', path: filePath, error: error.message }, '[IMPORT]');
    }
  }
}

/**
 * Process a batch of logs from streaming parser
 * This function handles normalization and insertion for streaming batches
 */
async function processLogBatch(batch, jobId, userId, importSource, importService, importTimestamp, conn, globalBatchSize) {
  const importSummary = {
    total: batch.length,
    inserted: 0,
    skipped: 0,
    missing_user: 0,
    missing_module: 0,
    missing_timestamp: 0,
    timestamp_inferred_count: 0,
    errors: 0,
  };

  let processed = 0;
  let errors = 0;
  let normalizedBatch = [];

  for (let i = 0; i < batch.length; i++) {
    try {
      const logEntry = batch[i];

      // Validate required fields
      if (!logEntry.timestamp) {
        importSummary.missing_timestamp++;
        importSummary.skipped++;
        logger.warn(
          { event: "missing_timestamp_streaming", logIndex: i, jobId },
          "[IMPORT]",
        );
        continue;
      }

      // Validate and warn about missing user/module
      if (!logEntry.target_user) {
        importSummary.missing_user++;
        // Don't skip — allow null target_user
      }

      if (logEntry.timestamp_inferred) {
        importSummary.timestamp_inferred_count++;
      }

      if (!logEntry.module) {
        importSummary.missing_module++;
        // Don't skip — allow null module
      }

      // Validate log_level and message exist
      if (!logEntry.log_level) {
        logEntry.log_level = "INFO";
      }
      if (!logEntry.message) {
        importSummary.skipped++;
        logger.warn(
          { event: "missing_message_streaming", logIndex: i, jobId },
          "[IMPORT]",
        );
        continue;
      }

      // Normalize log entry
      const normalized = {
        raw_log: logEntry.raw_log || JSON.stringify(logEntry),
        timestamp:
          logEntry.timestamp ||
          new Date().toISOString().slice(0, 19).replace("T", " "),
        created_time:
          logEntry.created_time ||
          String(logEntry.timestamp || "").slice(11, 19) ||
          null,
        timezone: logEntry.timezone || null,
        log_level: normalizeLevel(logEntry.log_level || "INFO"),
        source:
          logEntry.source || logEntry.source_server || importSource || null,
        source_server:
          logEntry.source_server ||
          logEntry.host ||
          logEntry.source ||
          importSource ||
          null,
        source_system:
          logEntry.source_system ||
          logEntry.source ||
          logEntry.source_server ||
          importSource ||
          null,
        service: logEntry.service || importService || null,
        message: logEntry.message || "",
        client_ip: logEntry.ip_address || logEntry.client_ip || null,
        module: logEntry.module || null,
        error_type: logEntry.error_type || null,
        stack_trace: logEntry.stack_trace || null,
        target_user: logEntry.target_user || null,
        parser_format: logEntry.log_format || null,
        timestamp_inferred: logEntry.timestamp_inferred ? 1 : 0,
        classification_confidence: logEntry.classification_confidence || null,
        source_type: 'import',
        ingested_realtime: 0,
        file_created_at: logEntry.file_created_at || null,
        file_modified_at: logEntry.file_modified_at || null,
        import_job_id: jobId,
        imported_by_user_id: userId,
        imported_at: importTimestamp,
        log_source: logEntry.source || logEntry.source_server || importSource || null,
      };

      normalized.normalized_message = normalizeMessage(normalized.message);
      normalized.event_type = classifyLog(
        normalized.message,
        normalized.source,
        normalized.service,
      );
      normalized.fingerprint = generateFingerprint(
        normalized.service,
        normalized.event_type,
        normalized.normalized_message,
        userId,
      );

      normalizedBatch.push(normalized);

      // Insert batch when it reaches global batch size
      if (normalizedBatch.length >= globalBatchSize) {
        await insertBatch(conn, normalizedBatch, userId);
        processed += normalizedBatch.length;
        importSummary.inserted += normalizedBatch.length;
        alertWorker.broadcastLogBatch(normalizedBatch, { userId, jobId });
        normalizedBatch = [];

        // Update job progress
        await conn.execute(
          "UPDATE import_jobs SET processed_lines = processed_lines + ?, error_count = error_count + ? WHERE id = ?",
          [processed, errors, jobId],
        );
      }
    } catch (e) {
      errors++;
      importSummary.errors++;
      logger.error(
        { event: "streaming_processing_error", lineIndex: i, jobId, error: e.message },
        "[IMPORT]",
      );
    }
  }

  // Insert remaining logs in batch
  if (normalizedBatch.length > 0) {
    await insertBatch(conn, normalizedBatch, userId);
    processed += normalizedBatch.length;
    importSummary.inserted += normalizedBatch.length;
    alertWorker.broadcastLogBatch(normalizedBatch, { userId, jobId });
  }

  // Update final progress
  await conn.execute(
    "UPDATE import_jobs SET processed_lines = processed_lines + ?, error_count = error_count + ? WHERE id = ?",
    [processed, errors, jobId],
  );

  logger.info(
    { event: "streaming_batch_processed", jobId, summary: importSummary },
    "[IMPORT]",
  );
}

async function insertBatch(conn, batch, userId) {
  await conn.beginTransaction();
  try {
    const orderedBatch = [...batch].sort((a, b) => {
      const aFingerprint = String(a.fingerprint || '');
      const bFingerprint = String(b.fingerprint || '');
      if (aFingerprint !== bFingerprint) return aFingerprint < bFingerprint ? -1 : 1;
      const aTimestamp = String(a.timestamp || '');
      const bTimestamp = String(b.timestamp || '');
      return aTimestamp === bTimestamp ? 0 : (aTimestamp < bTimestamp ? -1 : 1);
    });
    const logValues = orderedBatch.map((entry) => [
      entry.raw_log,
      entry.timestamp,
      entry.created_time,
      entry.timezone,
      entry.log_level,
      entry.source,
      entry.source_server,
      entry.source_system,
      entry.service,
      entry.message,
      entry.normalized_message,
      entry.event_type,
      entry.fingerprint,
      userId || null,
      entry.source_type,
      entry.ingested_realtime,
      entry.client_ip,
      entry.module,
      entry.error_type,
      entry.stack_trace,
      entry.target_user,
      entry.parser_format,
      entry.timestamp_inferred,
      entry.classification_confidence,
      entry.file_created_at || null,
      entry.file_modified_at || null,
      entry.imported_by_user_id || userId || null,
      entry.imported_at || null,
      entry.log_source || null,
      entry.import_job_id || null,
    ]);

    await conn.query(
      `INSERT IGNORE INTO logs (
        raw_log, timestamp, created_time, timezone, log_level, source, source_server, source_system, service, message, normalized_message,
        event_type, fingerprint, user_id, source_type, ingested_realtime, client_ip, module, error_type,
        stack_trace, target_user, parser_format, timestamp_inferred, classification_confidence,
        file_created_at, file_modified_at, imported_by_user_id, imported_at, log_source, import_job_id
      ) VALUES ?`,
      [logValues],
    );

    await upsertErrorGroupsFromLogs(conn, userId, orderedBatch, RETURN_GAP_DAYS);

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  }
}

// ── POST /upload ──────────────────────────────────────────────────────────────
// Simplified import for non-developers: drop files and click import
router.post(
  "/upload",
  importLimiter,
  upload.array("files", UPLOAD_MAX_FILES),
  async (req, res) => {
    try {
      const files = req.files;
      if (!files || files.length === 0)
        return res.status(400).json({ error: "Aucun fichier fourni" });

      const userId = req.session.user.id;
      const source = req.body.source || null;
      const service = req.body.service || null;
      const locale = req.body.locale || null;
      const totalFiles = files.length;

      const jobs = [];
      for (const file of files) {
        const jobId = uuidv4();
        await pool.execute(
          "INSERT INTO import_jobs (id, filename, file_size, import_ip_address, user_id, import_source, import_service, status, total_files) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 1)",
          [jobId, file.originalname, file.size || 0, req.ip, userId, source, service],
        );
        jobs.push({ jobId, filename: file.originalname, path: file.path });
      }

      for (const job of jobs) {
        // Passer le chemin au worker évite de charger tous les fichiers en RAM
        // pendant la requête d'upload et permet de traiter chaque fichier séparément.
        await importWorker.enqueue(
          job.jobId,
          job.path,
          job.filename,
          userId,
          source,
          service,
          locale
        );
      }

      await invalidateDashboard(userId);

      res.json({
        success: true,
        jobId: jobs[0].jobId,
        jobIds: jobs.map(job => job.jobId),
        jobs: jobs.map(({ jobId, filename }) => ({ jobId, filename })),
        message: totalFiles > 1 
          ? `Import de ${totalFiles} fichiers démarré en arrière-plan`
          : 'Import démarré en arrière-plan',
        totalFiles,
        filename: files[0].originalname
      });

    } catch (e) {
      logger.error({ event: 'import_upload_error', error: e.message }, '[IMPORT]');
      for (const file of req.files || []) {
        try {
          if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        } catch (cleanupError) {
          logger.warn({ event: 'temp_file_cleanup_error', path: file.path, error: cleanupError.message }, '[IMPORT]');
        }
      }
      if (!res.headersSent) res.status(500).json({ error: "Erreur lors de l'import" });
    }
  }
);

// ── GET /jobs ─────────────────────────────────────────────────────────────────
router.get("/jobs", async (req, res) => {
  try {
    const scope = userScope(req);
    const [rows] = await pool.execute(
      "SELECT * FROM import_jobs WHERE 1=1" +
        scope.sql +
        " ORDER BY created_at DESC LIMIT 20",
      scope.params,
    );

    // Normalisation de la réponse pour le frontend (Bug 4)
    const normalized = rows.map(r => ({
      ...r,
      originalName: r.filename,
      totalLines: r.total_lines,
      importedLines: r.processed_lines,
      processedLines: r.processed_lines,
      skippedLines: r.skipped_lines,
      createdAt: r.created_at,
      completedAt: r.completed_at,
    }));

    res.json(normalized);
  } catch (_e) {
    if (!res.headersSent) res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── GET /jobs/:id ─────────────────────────────────────────────────────────────
router.get("/jobs/:id", async (req, res) => {
  try {
    const scope = userScope(req);
    const [rows] = await pool.execute(
      "SELECT * FROM import_jobs WHERE id = ?" + scope.sql,
      [req.params.id, ...scope.params],
    );
    if (rows.length === 0)
      return res.status(404).json({ error: "Job non trouvé" });
    
    const job = rows[0];
    const progress = job.total_lines > 0 
      ? Math.round((job.processed_lines / job.total_lines) * 100) 
      : 0;

    res.json({
      jobId: job.id,
      filename: job.filename,
      status: job.status,
      progress,
      logsProcessed: job.processed_lines,
      logsTotal: job.total_lines,
      insertedLines: job.successful_lines || 0,
      skippedLines: job.skipped_lines || 0,
      createdAt: job.created_at,
      completedAt: job.completed_at,
      errorMessage: job.error_message,
      totalFiles: job.total_files,
      estimatedRemaining: job.status === 'inserting' && job.processed_lines > 0
        ? Math.round((job.total_lines - job.processed_lines) / (job.processed_lines / ((Date.now() - new Date(job.started_at || job.created_at).getTime()) / 1000)))
        : null
    });
  } catch (_e) {
    if (!res.headersSent) res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── GET /jobs/:id/status ───────────────────────────────────────────────────────
// Route spécifique pour le polling de statut en temps réel
router.get("/jobs/:id/status", async (req, res) => {
  try {
    const scope = userScope(req);
    const [rows] = await pool.execute(
      "SELECT * FROM import_jobs WHERE id = ?" + scope.sql,
      [req.params.id, ...scope.params],
    );
    
    if (rows.length === 0)
      return res.status(404).json({ error: "Job non trouvé" });

    const job = rows[0];
    const progress = job.total_lines > 0 
      ? Math.round((job.processed_lines / job.total_lines) * 100) 
      : 0;

    // Check worker status if job is still processing
    const workerStatus = importWorker.getJobStatus(req.params.id);

    res.json({
      jobId: job.id,
      status: job.status, // 'pending' | 'extracting' | 'parsing' | 'inserting' | 'completed' | 'failed'
      progress,
      logsProcessed: job.processed_lines,
      logsTotal: job.total_lines,
      insertedLines: job.successful_lines || 0,
      skippedLines: job.skipped_lines || 0,
      errorCount: job.error_count,
      createdAt: job.created_at,
      startedAt: job.started_at,
      completedAt: job.completed_at,
      errorMessage: job.error_message,
      importSummary: (() => {
        if (!job.import_summary) return null;
        try {
          return typeof job.import_summary === 'string'
            ? JSON.parse(job.import_summary)
            : job.import_summary;
        } catch {
          return null;
        }
      })(),
      workerStatus: workerStatus.status
    });
  } catch (_e) {
    if (!res.headersSent) res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── GET /jobs/:id/summary ─────────────────────────────────────────────────────
// AMÉLIORATION 1: Return detailed import summary for display
router.get("/jobs/:id/summary", async (req, res) => {
  try {
    const scope = userScope(req);
    const [jobRows] = await pool.execute(
      "SELECT id, filename, total_lines, processed_lines, successful_lines, skipped_lines, error_count, status, import_source, import_service, completed_at FROM import_jobs WHERE id = ?" +
        scope.sql,
      [req.params.id, ...scope.params],
    );

    if (jobRows.length === 0) {
      return res.status(404).json({ error: "Job non trouvé" });
    }

    const job = jobRows[0];
    const total = job.total_lines || 0;
    const processed = job.processed_lines || 0;
    const inserted = job.successful_lines || 0;
    const errors = job.error_count || 0;
    const skipped = job.skipped_lines || 0;

    // Calculate from logs: count by target_user and module presence
    let missing_user = 0;
    let missing_module = 0;

    if (job.status === "completed" && total > 0) {
      const [stats] = await pool.execute(
        `SELECT
          COALESCE(SUM(CASE WHEN target_user IS NULL THEN 1 ELSE 0 END), 0) as cnt_missing_user,
          COALESCE(SUM(CASE WHEN module IS NULL THEN 1 ELSE 0 END), 0) as cnt_missing_module
         FROM logs
         WHERE import_job_id = ? AND user_id = ?`,
        [job.id, req.session.user.id],
      );

      if (stats && stats[0]) {
        missing_user = stats[0].cnt_missing_user || 0;
        missing_module = stats[0].cnt_missing_module || 0;
      }
    }

    const summary = {
      total,
      processed,
      inserted,
      skipped,
      source: job.import_source || null,
      service: job.import_service || null,
      filename: job.filename || null,
      completed_at: job.completed_at || null,
      missing_user,
      missing_module,
      missing_timestamp: 0,
      errors,
      status: job.status,
    };

    res.json(summary);
  } catch (e) {
    logger.error({ event: "summary_error", error: e.message }, "[IMPORT]");
    if (!res.headersSent) res.status(500).json({ error: "Erreur lors du calcul du résumé" });
  }
});

// GET /imported-today - Get logs imported today for watchlog
router.get('/imported-today', async (req, res) => {
  try {
    const scope = userScope(req);
    const today = new Date().toISOString().slice(0, 10);
    
    const [rows] = await pool.execute(
      `SELECT id, timestamp, log_level, message, source_server, source, service, imported_at, 
              import_job_id, imported_by_user_id
       FROM logs
       WHERE imported_at >= ? AND imported_at < ?${scope.sql}
       ORDER BY imported_at DESC
       LIMIT 100`,
      [today + ' 00:00:00', today + ' 23:59:59', ...scope.params]
    );
    
    res.json({ imported_logs: rows });
  } catch (e) {
    logger.error({ event: 'imported_today_error', error: e.message }, '[IMPORT]');
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;

// [FIX-12] Gestionnaire d'erreur Multer — doit être APRÈS export default et les routes
// pour être capturé par Express comme middleware d'erreur (4 paramètres)
export function multerErrorHandler(err, req, res, next) {
  const isImportUpload = req.originalUrl?.split('?')[0] === '/api/import/upload';
  if (isImportUpload && err instanceof multer.MulterError) {
    const messages = {
      LIMIT_FILE_COUNT: 'Trop de fichiers',
      LIMIT_UNEXPECTED_FILE: 'Champ de fichier inattendu',
      LIMIT_FILE_SIZE: `Fichier trop volumineux (maximum ${Math.round(UPLOAD_MAX_SIZE / 1024 / 1024)} Mo par fichier)`,
    };
    const message = messages[err.code] || 'Erreur de téléversement';
    logger.warn({ event: 'multer_error', code: err.code, field: err.field }, `[IMPORT] ${message}`);
    if (!res.headersSent) {
      return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: message });
    }
  }
  if (isImportUpload && err?.status === 400) {
    logger.warn({ event: 'upload_validation_error', error: err.message }, '[IMPORT]');
    if (!res.headersSent) return res.status(400).json({ error: err.message });
  }
  next(err);
}
