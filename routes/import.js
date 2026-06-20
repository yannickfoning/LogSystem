import { Router } from "express";
import multer from "multer";
import fs from "fs/promises";
import { createReadStream } from "fs";
import os from "os";
import path from "path";
import { createHash } from "crypto";
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
import { normalizeLevel } from "../config/database.js";
import { alertEngineBus } from "../services/alertEngine.js";
import { alertWorker } from "../workers/alertWorker.js";
import { recordAudit } from "../middleware/audit.js";
import { validateBody, importUploadSchema } from "../middleware/validation.js";
import { invalidateDashboard } from "../services/cacheService.js";
import { extractArchive, isArchive, filterLogFiles, mapArchiveError, ArchiveError } from "../lib/processing/archiveHandler.js";
import { importLimiter } from "../lib/rateLimiter.js";

const router = Router();
router.use(requireAuth);
const RETURN_GAP_DAYS = parseInt(process.env.ERROR_RETURN_GAP_DAYS || "7", 10);

const uploadDir = path.join(os.tmpdir(), "logsystem-uploads");

const upload = multer({
  storage: multer.diskStorage({
    async destination(_req, _file, cb) {
      try {
        await fs.mkdir(uploadDir, { recursive: true });
        cb(null, uploadDir);
      } catch (e) {
        cb(e);
      }
    },
    filename(_req, file, cb) {
      const ext = path.extname(file.originalname || "");
      cb(null, `${uuidv4()}${ext}`);
    },
  }),
  limits: {
    fileSize: parseInt(process.env.UPLOAD_MAX_SIZE || process.env.IMPORT_MAX_SIZE || "524288000", 10),
    files: parseInt(process.env.UPLOAD_MAX_FILES || "10", 10),
  },
  fileFilter: (req, file, cb) => {
    const filename = file.originalname;
    if (!filename || filename.trim().length === 0)
      return cb(new Error("Nom de fichier requis"));
    if (filename.length > 255)
      return cb(new Error("Nom de fichier trop long (max 255 caractères)"));

    const validNamePattern = /^[a-zA-Z0-9._\-\s]+$/;
    if (!validNamePattern.test(filename))
      return cb(
        new Error("Nom de fichier contient des caractères non autorisés"),
      );

    const allowedMimeTypes = [
      "text/plain",
      "text/log",
      "application/json",
      "application/jsonl",
      "text/x-log",
      "application/octet-stream",
      "application/zip",
      "application/gzip",
      "application/x-gzip",
      "application/x-tar",
      "application/x-brotli",
      "application/zstd",
      "application/vnd.rar",
      "application/x-rar-compressed",
      "application/x-7z-compressed",
    ];
    if (file.mimetype && !allowedMimeTypes.includes(file.mimetype)) {
      return cb(new Error(`Type MIME non supporté: ${file.mimetype}`));
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
      "br",
      "brotli",
      "zst",
      "zstandard",
      "rar",
      "7z",
    ];
    if (!allowedExtensions.includes(ext)) {
      return cb(
        new Error(
          `Extension non supportée. Utilisez: ${allowedExtensions.join(", ")}`,
        ),
      );
    }

    cb(null, true);
  },
});

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (value >= 1024 * 1024) return `${Math.round(value / 1024 / 1024)} MB`;
  return `${Math.round(value / 1024)} KB`;
}

async function processImport(
  jobId,
  buffer,
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
    parseInt(process.env.IMPORT_BATCH_SIZE || "500", 10),
    500,
  );
  const importTimestamp = new Date().toISOString().slice(0, 19).replace("T", " ");

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

  for (const file of filesToProcess) {
    const detectedFormat = detectFormat(file.content);
    logger.info(
      { event: "format_detected", format: detectedFormat, file: file.filename },
      "[IMPORT]",
    );

    let parsedLogs;
    try {
      parsedLogs = await parseLogContent(file.content, detectedFormat, {
        source: importSource,
        service: importService,
        locale: dateLocale,
      });
    } catch (e) {
      logger.error(
        { event: "parsing_error", format: detectedFormat, error: e.message },
        "[IMPORT]",
      );
      parsedLogs = [];
    }
    allParsedLogs = allParsedLogs.concat(
      parsedLogs.map((log) => ({
        ...log,
        file_name: file.filename,
        file_created_at: file.file_created_at || null,
        file_modified_at: file.file_modified_at || null,
      })),
    );
  }

  const parsedLogs = allParsedLogs;
  const total = parsedLogs.length;
  logger.info({ event: "lines_parsed", count: total, jobId }, "[IMPORT]");

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
    await conn.execute(
      "UPDATE import_jobs SET status = ?, total_lines = ?, started_at = NOW() WHERE id = ?",
      ["processing", total, jobId],
    );

    if (total === 0) {
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
    let batch = [];

    for (let i = 0; i < parsedLogs.length; i++) {
      try {
        const logEntry = parsedLogs[i];

        // AMÉLIORATION 1: Validate required fields
        // timestamp is guaranteed by normalizeLog, but check it's valid
        if (!logEntry.timestamp) {
          importSummary.missing_timestamp++;
          importSummary.skipped++;
          logger.warn(
            { event: "missing_timestamp", logIndex: i, jobId },
            "[IMPORT]",
          );
          continue;
        }

        // Validate and warn about missing user/module
        if (!logEntry.target_user) {
          importSummary.missing_user++;
          logger.warn(
            { event: "missing_user", logIndex: i, jobId },
            "[IMPORT]",
          );
          // Don't skip — allow null target_user
        }

        if (logEntry.timestamp_inferred) {
          importSummary.timestamp_inferred_count++;
        }

        if (!logEntry.module) {
          importSummary.missing_module++;
          logger.warn(
            { event: "missing_module", logIndex: i, jobId },
            "[IMPORT]",
          );
          // Don't skip — allow null module
        }

        // Validate log_level and message exist
        if (!logEntry.log_level) {
          logEntry.log_level = "INFO";
        }
        if (!logEntry.message) {
          importSummary.skipped++;
          logger.warn(
            { event: "missing_message", logIndex: i, jobId },
            "[IMPORT]",
          );
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
          file_name: (logEntry.file_name || filename || "").slice(0, 255),
          import_job_id: jobId,
          imported_by_user_id: userId,
          imported_at: importTimestamp,
          log_source: logEntry.source || logEntry.source_server || importSource || null,
          log_user: logEntry.target_user || logEntry.log_user || null,
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
      setImmediate(() => {
        alertEngineBus.emit("logs.inserted", {
          userId,
          count: processed,
          summary: importSummary,
        });
      });
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
  }
}

async function insertBatch(conn, batch, userId) {
  await conn.beginTransaction();
  try {
    const logValues = batch.map((entry) => [
      entry.raw_log,
      entry.timestamp,
      entry.created_time,
      entry.timezone,
      entry.log_level,
      entry.source,
      entry.source_server,
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
      entry.file_name || null,
      entry.import_job_id || null,
      entry.imported_by_user_id || userId || null,
      entry.imported_at || null,
      entry.log_source || null,
      entry.log_user || null,
    ]);

    await conn.query(
      `INSERT IGNORE INTO logs (
        raw_log, timestamp, created_time, timezone, log_level, source, source_server, service, message, normalized_message,
        event_type, fingerprint, user_id, source_type, ingested_realtime, client_ip, module, error_type,
        stack_trace, target_user, parser_format, timestamp_inferred, classification_confidence,
        file_created_at, file_modified_at, file_name, import_job_id, imported_by_user_id, imported_at, log_source, log_user
      ) VALUES ?`,
      [logValues],
    );

    // FIX: error_groups — severity_max est VARCHAR donc on compare avec FIELD()
    // pour éviter GREATEST() sur des types incompatibles
    const errorGroupValues = batch
      .filter(entry => ['ERROR', 'CRITICAL', 'FATAL'].includes(entry.log_level))
      .map((entry) => [
        entry.fingerprint,
        (entry.message || "").slice(0, 500),
        entry.event_type,
        entry.log_level,
        1,
        entry.timestamp,
        entry.timestamp,
        entry.source_server,
        entry.service,
        entry.error_type,
        userId || null,
      ]);

    if (errorGroupValues.length > 0) {
      const placeholders = errorGroupValues
        .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .join(",");
      const flatParams = errorGroupValues.flat();

      // FIX: utiliser FIELD() pour comparer les niveaux texte correctement
      await conn.query(
        `INSERT INTO error_groups (fingerprint, title, event_type, severity_max, occurrence_count, first_seen, last_seen, source_server, service, error_type, user_id)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           occurrence_count = occurrence_count + 1,
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
             'open'
           ),
           last_seen = GREATEST(last_seen, VALUES(last_seen)),
           first_seen = LEAST(first_seen, VALUES(first_seen)),
           source_server = COALESCE(VALUES(source_server), source_server),
           service = COALESCE(VALUES(service), service),
           error_type = COALESCE(VALUES(error_type), error_type),
           severity_max = IF(
             FIELD(VALUES(severity_max), 'DEBUG','INFO','WARNING','ERROR','CRITICAL','FATAL') >
             FIELD(severity_max,         'DEBUG','INFO','WARNING','ERROR','CRITICAL','FATAL'),
             VALUES(severity_max),
             severity_max
           )`,
        [
          ...flatParams,
          RETURN_GAP_DAYS,
          RETURN_GAP_DAYS,
          RETURN_GAP_DAYS,
          RETURN_GAP_DAYS,
        ],
      );
    }

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  }
}

// ── POST /upload ──────────────────────────────────────────────────────────────
router.post(
  "/upload",
  importLimiter,
  upload.single("file"),
  validateBody(importUploadSchema),
  async (req, res) => {
    let importAccepted = false;
    const importTimeout = setTimeout(() => {
      logger.warn({ event: "import_upload_timeout" }, "[IMPORT] Timeout after 10 minutes");
    }, 10 * 60 * 1000);

    try {
      if (!req.file) {
        clearTimeout(importTimeout);
        return res.status(400).json({ error: "Aucun fichier fourni" });
      }

      const maxSize = parseInt(process.env.UPLOAD_MAX_SIZE || process.env.IMPORT_MAX_SIZE || "524288000", 10);
      if (req.file.size > maxSize) {
        clearTimeout(importTimeout);
        fs.rm(req.file.path, { force: true }).catch(() => {});
        return res.status(413).json({
          error: `Fichier trop gros (${formatBytes(req.file.size)} reçu, limite ${formatBytes(maxSize)}). Divisez en plusieurs archives.`,
        });
      }

      const jobId = uuidv4();
      const userId = req.session.user.id;
      const source = req.body.source || null;
      const service = req.body.service || null;
      const locale = req.body.locale || null;

      const fileHash = await hashFile(req.file.path);

      await pool.execute(
        "INSERT INTO import_jobs (id, filename, file_size, file_hash, import_ip_address, user_id, import_source, import_service, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')",
        [
          jobId,
          req.file.originalname,
          req.file.size || null,
          fileHash,
          req.ip,
          userId,
          source,
          service,
        ],
      );

      importAccepted = true;
      Promise.resolve().then(async () => {
        const buffer = await fs.readFile(req.file.path);
        return processImport(
          jobId,
          buffer,
          req.file.originalname,
          userId,
          source,
          service,
          locale,
        );
      }).catch((e) => {
        const mapped = e instanceof ArchiveError ? e : mapArchiveError(e);
        pool.execute(
          "UPDATE import_jobs SET status = ?, error_message = ?, completed_at = NOW() WHERE id = ?",
          ["failed", mapped.message.substring(0, 1000), jobId],
        ).catch(() => {});
        logger.error(
          { event: "import_fatal", jobId, error: mapped.message, code: mapped.code },
          "[IMPORT]",
        );
      }).finally(() => {
        clearTimeout(importTimeout);
        fs.rm(req.file.path, { force: true }).catch(() => {});
      });

      await recordAudit({
        userId,
        userEmail: req.session.user.email,
        action: "import_upload",
        resourceType: "import_job",
        resourceId: jobId,
        details: {
          file: req.file.originalname,
          size: req.file.size || null,
          hash: fileHash,
        },
        ipAddress: req.ip,
      });

      res.json({ job_id: jobId, filename: req.file.originalname });
    } catch (e) {
      clearTimeout(importTimeout);
      if (!importAccepted && req.file?.path) {
        fs.rm(req.file.path, { force: true }).catch(() => {});
      }
      logger.error({ event: "upload_error", error: e.message }, "[IMPORT]");
      if (e instanceof ArchiveError) {
        return res.status(e.status).json({ error: e.message });
      }
      res.status(500).json({ error: e.message || "Erreur lors de l'upload" });
    }
  },
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
  } catch (e) {
    logger.error({ event: "import_jobs_list_error", error: e.message }, "[IMPORT]");
    res.status(500).json({ error: "Erreur serveur" });
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
    res.json(rows[0]);
  } catch (e) {
    logger.error({ event: "import_job_detail_error", error: e.message }, "[IMPORT]");
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── GET /jobs/:id/summary ─────────────────────────────────────────────────────
// AMÉLIORATION 1: Return detailed import summary for display
router.get("/jobs/:id/summary", async (req, res) => {
  try {
    const scope = userScope(req);
    const [jobRows] = await pool.execute(
      "SELECT id, total_lines, processed_lines, error_count, status FROM import_jobs WHERE id = ?" +
        scope.sql,
      [req.params.id, ...scope.params],
    );

    if (jobRows.length === 0) {
      return res.status(404).json({ error: "Job non trouvé" });
    }

    const job = jobRows[0];
    const total = job.total_lines || 0;
    const inserted = job.processed_lines || 0;
    const errors = job.error_count || 0;
    const skipped =
      job.skipped_lines != null
        ? job.skipped_lines
        : Math.max(0, total - inserted - errors);

    // Calculate from logs: count by target_user and module presence
    let missing_user = 0;
    let missing_module = 0;

    if (job.status === "completed" && total > 0) {
      const [stats] = await pool.execute(
        `SELECT
          SUM(CASE WHEN target_user IS NULL THEN 1 ELSE 0 END) as cnt_missing_user,
          SUM(CASE WHEN module IS NULL THEN 1 ELSE 0 END) as cnt_missing_module
         FROM logs
         WHERE created_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE) AND user_id = ?
         LIMIT ${inserted}`,
        [req.session.user.id],
      );

      if (stats && stats[0]) {
        missing_user = stats[0].cnt_missing_user || 0;
        missing_module = stats[0].cnt_missing_module || 0;
      }
    }

    const summary = {
      total,
      inserted,
      skipped,
      source: job.import_source || null,
      service: job.import_service || null,
      filename: job.filename || null,
      completed_at: job.completed_at || null,
      missing_user,
      missing_module,
      missing_timestamp: skipped > 0 ? skipped : 0,
      errors,
      status: job.status,
    };

    res.json(summary);
  } catch (e) {
    logger.error({ event: "summary_error", error: e.message }, "[IMPORT]");
    res.status(500).json({ error: "Erreur lors du calcul du résumé" });
  }
});

export default router;

// [FIX-12] Gestionnaire d'erreur Multer — doit être APRÈS export default et les routes
// pour être capturé par Express comme middleware d'erreur (4 paramètres)
export function multerErrorHandler(err, req, res, next) {
  if (err && err.code && err.code.startsWith('LIMIT_')) {
    // MulterError : fichier trop grand, trop de fichiers, champ inconnu...
    const messages = {
      LIMIT_FILE_SIZE: `Fichier trop gros (limite ${formatBytes(parseInt(process.env.UPLOAD_MAX_SIZE || process.env.IMPORT_MAX_SIZE || "524288000", 10))}). Divisez en plusieurs archives.`,
      LIMIT_FILE_COUNT: 'Trop de fichiers',
      LIMIT_UNEXPECTED_FILE: 'Champ de fichier inattendu',
    };
    const message = messages[err.code] || 'Erreur de téléversement';
    logger.warn({ event: 'multer_error', code: err.code, field: err.field }, `[IMPORT] ${message}`);
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: message });
  }
  next(err);
}
