import { Router } from "express";
import { statfs } from "node:fs/promises";
import logger from "../config/logger.js";
import bcrypt from "bcryptjs";
import pool from "../config/database.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { recordAudit } from "../middleware/audit.js";
import {
  runRetention,
  getRetentionStats,
} from "../services/retentionService.js";
import {
  validateBody,
  alertRuleSchema,
  alertUpdateSchema,
  createUserSchema,
  updateUserSchema,
  resetPasswordSchema,
  purgeSchema,
} from "../middleware/validation.js";
import { shareLogsByEmail, shareLogsByWhatsApp } from "../services/emailShareService.js";
import { getRedisClient, invalidateAllDashboards } from "../services/cacheService.js";

const router = Router();
router.use(requireAuth, requireAdmin);

// ─── SYSTEM STATUS ────────────────────────────────────────

router.get("/system/status", async (req, res) => {
  try {
    const systemStatus = {
      database: { connected: false, status: 'unknown' },
      redis: { connected: false, mode: 'unknown' },
      watcher: { running: false, status: 'unknown' },
      cache: { enabled: false, status: 'unknown' },
      uptime: process.uptime(),
      version: process.env.npm_package_version || '6.0.0'
    };

    // Check database status
    try {
      await pool.execute('SELECT 1');
      systemStatus.database = { 
        connected: true, 
        status: 'ok',
        connections: pool.pool?.pool?._allConnections?.length || 0,
        free: pool.pool?.pool?._freeConnections?.length || 0
      };
    } catch (dbError) {
      systemStatus.database = { 
        connected: false, 
        status: 'error',
        error: dbError.message 
      };
    }

    // Check Redis status
    try {
      const redisClient = getRedisClient();
      if (redisClient) {
        await redisClient.ping();
        systemStatus.redis = { 
          connected: true, 
          mode: 'active',
          status: 'ok'
        };
        systemStatus.cache = { 
          enabled: true, 
          status: 'active'
        };
      } else {
        systemStatus.redis = { 
          connected: false, 
          mode: 'degraded',
          status: 'disabled'
        };
        systemStatus.cache = { 
          enabled: false, 
          status: 'disabled'
        };
      }
    } catch (redisError) {
      systemStatus.redis = { 
        connected: false, 
        mode: 'degraded',
        status: 'error',
        error: redisError.message 
      };
      systemStatus.cache = { 
        enabled: false, 
        status: 'degraded'
      };
    }

    // Check watcher status
    try {
      const { getWatcherStatus } = await import("../services/watcherService.js");
      const watcherStatus = getWatcherStatus();
      systemStatus.watcher = { 
        running: watcherStatus.running || false,
        status: watcherStatus.running ? 'active' : 'inactive',
        watchedDirectories: watcherStatus.watchedDirectories || []
      };
    } catch (watcherError) {
      systemStatus.watcher = { 
        running: false, 
        status: 'error',
        error: watcherError.message 
      };
    }

    // Overall system health
    const isHealthy = systemStatus.database.connected && 
                      (systemStatus.redis.connected || systemStatus.redis.mode === 'degraded');
    
    systemStatus.overall = {
      status: isHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString()
    };

    res.json(systemStatus);
  } catch (e) {
    logger.error({ event: 'system_status_error', error: e.message }, '[ADMIN]');
    res.status(500).json({ 
      error: "Erreur lors de la récupération du statut système",
      database: { connected: false, status: 'error' },
      redis: { connected: false, status: 'error' },
      overall: { status: 'error', timestamp: new Date().toISOString() }
    });
  }
});

// ─── USERS CRUD ────────────────────────────────────────

router.get("/users", async (req, res) => {
  try {
    const [rows] = await pool.execute(
      "SELECT id, email, display_name, role, is_active, last_login, created_at FROM users ORDER BY created_at DESC",
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/users", validateBody(createUserSchema), async (req, res) => {
  try {
    const { email, password, display_name, role } = req.body;

    const [existing] = await pool.execute(
      "SELECT id FROM users WHERE email = ?",
      [email],
    );
    if (existing.length > 0)
      return res.status(409).json({ error: "Email déjà utilisé" });

    const rounds = parseInt(process.env.BCRYPT_ROUNDS || "12", 10);
    const hash = await bcrypt.hash(password, rounds);
    const [result] = await pool.execute(
      "INSERT INTO users (email, password_hash, display_name, role) VALUES (?, ?, ?, ?)",
      [email, hash, display_name || null, role || "user"],
    );

    await recordAudit({
      userId: req.session.user.id,
      userEmail: req.session.user.email,
      action: "create_user",
      resourceType: "user",
      resourceId: String(result.insertId),
      details: `Created user: ${email}`,
      ipAddress: req.ip,
    });

    res.json({ success: true, id: result.insertId });
  } catch (e) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.put("/users/:id", validateBody(updateUserSchema), async (req, res) => {
  try {
    const { display_name, role, is_active } = req.body;
    const userId = parseInt(req.params.id);

    if (role && req.session.user.id === userId) {
      return res
        .status(403)
        .json({ error: "Vous ne pouvez pas modifier votre propre rôle" });
    }

    if (is_active === false && req.session.user.id === userId) {
      return res
        .status(403)
        .json({ error: "Vous ne pouvez pas vous désactiver" });
    }

    const fields = [];
    const params = [];

    if (display_name !== undefined) {
      fields.push("display_name = ?");
      params.push(display_name);
    }
    if (role) {
      fields.push("role = ?");
      params.push(role);
    }
    if (is_active !== undefined) {
      fields.push("is_active = ?");
      params.push(is_active ? 1 : 0);
    }

    if (fields.length === 0)
      return res.status(400).json({ error: "Aucun champ à modifier" });

    params.push(userId);
    await pool.execute(
      `UPDATE users SET ${fields.join(", ")} WHERE id = ?`,
      params,
    );

    await recordAudit({
      userId: req.session.user.id,
      userEmail: req.session.user.email,
      action: "update_user",
      resourceType: "user",
      resourceId: String(userId),
      details: `Updated user ${userId}: ${fields.join(", ")}`,
      ipAddress: req.ip,
    });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.delete("/users/:id", async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (req.session.user.id === userId) {
      return res
        .status(403)
        .json({ error: "Vous ne pouvez pas supprimer votre propre compte" });
    }

    // Vérifier si c'est le dernier admin actif
    const [adminCheck] = await pool.execute(
      "SELECT COUNT(*) as cnt FROM users WHERE role = 'admin' AND is_active = 1 AND id != ?",
      [userId],
    );
    if (adminCheck[0].cnt === 0) {
      return res.status(400).json({
        error: "Impossible de supprimer le dernier administrateur actif",
      });
    }

    const [result] = await pool.execute("DELETE FROM users WHERE id = ?", [
      userId,
    ]);
    if (result.affectedRows === 0)
      return res.status(404).json({ error: "Utilisateur non trouvé" });

    await recordAudit({
      userId: req.session.user.id,
      userEmail: req.session.user.email,
      action: "delete_user",
      resourceType: "user",
      resourceId: String(userId),
      details: `Deleted user ${userId}`,
      ipAddress: req.ip,
    });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post(
  "/users/:id/reset-password",
  validateBody(resetPasswordSchema),
  async (req, res) => {
    try {
      const { password } = req.body;

      const rounds = parseInt(process.env.BCRYPT_ROUNDS || "12", 10);
      const hash = await bcrypt.hash(password, rounds);
      await pool.execute("UPDATE users SET password_hash = ? WHERE id = ?", [
        hash,
        req.params.id,
      ]);

      await recordAudit({
        userId: req.session.user.id,
        userEmail: req.session.user.email,
        action: "reset_password",
        resourceType: "user",
        resourceId: req.params.id,
        details: `Password reset for user ${req.params.id}`,
        ipAddress: req.ip,
      });

      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: "Erreur serveur" });
    }
  },
);

// ─── ALERT RULES CRUD ──────────────────────────────────

router.get("/alert-rules", async (req, res) => {
  try {
    const [rows] = await pool.execute(
      "SELECT ar.*, u.email as created_by_email FROM alert_rules ar LEFT JOIN users u ON ar.created_by = u.id WHERE ar.created_by = ? OR ar.is_global = 1 ORDER BY ar.created_at DESC",
      [req.session.user.id],
    );
    res.json(rows);
  } catch (e) {
    if (/Unknown column.*is_global/i.test(e.message)) {
      // Fallback for databases without is_global column
      const [rows] = await pool.execute(
        "SELECT ar.*, u.email as created_by_email FROM alert_rules ar LEFT JOIN users u ON ar.created_by = u.id WHERE ar.created_by = ? ORDER BY ar.created_at DESC",
        [req.session.user.id],
      );
      return res.json(rows);
    }
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/alert-rules", validateBody(alertRuleSchema), async (req, res) => {
  try {
    const {
      name,
      description,
      condition_type,
      condition_value,
      threshold_value,
      time_window_minutes,
      severity,
      cooldown_minutes,
    } = req.body;

    const [result] = await pool.execute(
      "INSERT INTO alert_rules (name, description, condition_type, condition_value, threshold_value, time_window_minutes, severity, cooldown_minutes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        name,
        description || null,
        condition_type,
        condition_value,
        threshold_value || null,
        time_window_minutes || 60,
        severity || "medium",
        cooldown_minutes || 30,
        req.session.user.id,
      ],
    );

    await recordAudit({
      userId: req.session.user.id,
      userEmail: req.session.user.email,
      action: "create_alert_rule",
      resourceType: "alert_rule",
      resourceId: String(result.insertId),
      details: `Created rule: ${name}`,
      ipAddress: req.ip,
    });

    res.status(201).json({ success: true, id: result.insertId });
  } catch (e) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.put("/alert-rules/:id", async (req, res) => {
  try {
    const {
      name,
      description,
      condition_type,
      condition_value,
      threshold_value,
      time_window_minutes,
      severity,
      cooldown_minutes,
      is_active,
    } = req.body;

    const fields = [];
    const params = [];
    if (name !== undefined) {
      fields.push("name = ?");
      params.push(name);
    }
    if (description !== undefined) {
      fields.push("description = ?");
      params.push(description);
    }
    if (condition_type !== undefined) {
      fields.push("condition_type = ?");
      params.push(condition_type);
    }
    if (condition_value !== undefined) {
      fields.push("condition_value = ?");
      params.push(condition_value);
    }
    if (threshold_value !== undefined) {
      fields.push("threshold_value = ?");
      params.push(threshold_value);
    }
    if (time_window_minutes !== undefined) {
      fields.push("time_window_minutes = ?");
      params.push(time_window_minutes);
    }
    if (severity !== undefined) {
      fields.push("severity = ?");
      params.push(severity);
    }
    if (cooldown_minutes !== undefined) {
      fields.push("cooldown_minutes = ?");
      params.push(cooldown_minutes);
    }
    if (is_active !== undefined) {
      fields.push("is_active = ?");
      params.push(is_active ? 1 : 0);
    }

    if (fields.length === 0)
      return res.status(400).json({ error: "Aucun champ à modifier" });

    params.push(req.params.id, req.session.user.id);
    const [result] = await pool.execute(
      `UPDATE alert_rules SET ${fields.join(", ")} WHERE id = ? AND created_by = ?`,
      params,
    );
    if (result.affectedRows === 0)
      return res.status(404).json({ error: "Règle non trouvée" });

    res.status(200).json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.delete("/alert-rules/:id", async (req, res) => {
  try {
    const [owned] = await pool.execute(
      "SELECT id FROM alert_rules WHERE id = ? AND created_by = ?",
      [req.params.id, req.session.user.id],
    );
    if (owned.length === 0)
      return res.status(404).json({ error: "Règle non trouvée" });
    await pool.execute("DELETE FROM alerts WHERE rule_id = ? AND user_id = ?", [
      req.params.id,
      req.session.user.id,
    ]);
    const [result] = await pool.execute(
      "DELETE FROM alert_rules WHERE id = ? AND created_by = ?",
      [req.params.id, req.session.user.id],
    );
    if (result.affectedRows === 0)
      return res.status(404).json({ error: "Règle non trouvée" });

    await recordAudit({
      userId: req.session.user.id,
      userEmail: req.session.user.email,
      action: "delete_alert_rule",
      resourceType: "alert_rule",
      resourceId: req.params.id,
      ipAddress: req.ip,
    });

    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── ALERTS (dismiss/read) ─────────────────────────────

// A-06: PATCH /api/admin/alerts/:id to update alert status
router.patch("/alerts/:id", async (req, res) => {
  try {
    const { status } = req.body;

    if (!["dismissed", "read", "new"].includes(status)) {
      return res
        .status(400)
        .json({ error: "Status invalide. Accepté: new, read, dismissed" });
    }

    const alertId = parseInt(req.params.id, 10);
    if (isNaN(alertId)) {
      return res.status(400).json({ error: "Alert ID invalide" });
    }

    // Check alert belongs to user or admin can modify
    const [alerts] = await pool.execute("SELECT * FROM alerts WHERE id = ?", [
      alertId,
    ]);

    if (alerts.length === 0) {
      return res.status(404).json({ error: "Alert non trouvée" });
    }

    const alert = alerts[0];

    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    const readAt = status === "read" ? now : null;

    await pool.execute(
      "UPDATE alerts SET status = ?, read_at = ? WHERE id = ?",
      [status, readAt, alertId],
    );

    await recordAudit({
      userId: req.session.user.id,
      userEmail: req.session.user.email,
      action: "update_alert_status",
      resourceType: "alert",
      resourceId: String(alertId),
      details: `Status changed to: ${status}`,
      ipAddress: req.ip,
    });

    // Broadcast update to SSE clients
    const { alertWorker } = await import("../workers/alertWorker.js");
    if (alertWorker) {
      alertWorker.broadcast("alert_updated", {
        id: alertId,
        status,
        read_at: readAt,
        user_id: alert.user_id,
      });
    }

    res.json({ success: true, id: alertId, status });
  } catch (e) {
    logger.error(
      { event: "alert_status_error", error: e.message },
      "[ALERT STATUS]",
    );
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── AUDIT LOG ─────────────────────────────────────────

router.get("/audit", async (req, res) => {
  try {
    const {
      user_id,
      action,
      resource_type,
      date_from,
      date_to,
      page = 1,
      limit = 50,
    } = req.query;

    // Fix #4: Bound LIMIT to prevent DoS
    const limitVal = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
    const pageVal = Math.max(parseInt(page) || 1, 1);

    let sql = "SELECT * FROM audit_log WHERE 1=1";
    let countSql = "SELECT COUNT(*) as total FROM audit_log WHERE 1=1";
    const params = [];
    const countParams = [];

    if (user_id) {
      sql += " AND user_id = ?";
      params.push(user_id);
      countSql += " AND user_id = ?";
      countParams.push(user_id);
    }
    if (action) {
      sql += " AND action = ?";
      params.push(action);
      countSql += " AND action = ?";
      countParams.push(action);
    }
    if (resource_type) {
      sql += " AND resource_type = ?";
      params.push(resource_type);
      countSql += " AND resource_type = ?";
      countParams.push(resource_type);
    }
    if (date_from) {
      sql += " AND created_at >= ?";
      params.push(date_from);
      countSql += " AND created_at >= ?";
      countParams.push(date_from);
    }
    if (date_to) {
      sql += " AND created_at <= ?";
      params.push(date_to);
      countSql += " AND created_at <= ?";
      countParams.push(date_to);
    }

    const offset = (pageVal - 1) * limitVal;
    const [countRows] = await pool.execute(countSql, countParams);
    const total = countRows[0].total;

    // pool.query() — mysql2 execute() doesn't support LIMIT ? OFFSET ? in prepared stmts
    sql += ` ORDER BY created_at DESC LIMIT ${limitVal} OFFSET ${offset}`;

    const [rows] = await pool.query(sql, params);

    res.json({
      data: rows,
      pagination: {
        page: pageVal,
        limit: limitVal,
        total,
        pages: Math.ceil(total / limitVal),
      },
    });
  } catch (e) {
    logger.error({ event: 'audit_error', error: e.message }, '[ADMIN]');
    res.status(500).json({ error: "Erreur serveur", details: e.message });
  }
});

// ─── RETENTION ─────────────────────────────────────────

router.get("/retention/stats", async (req, res) => {
  try {
    const stats = await getRetentionStats();
    res.json(stats);
  } catch (e) {
    logger.error({ event: 'admin_retention_stats_error', error: e.message }, '[ADMIN]');
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── Week 4: Fonctionnalités Avancées ─────────────────────

// GET /platforms/check-health - Multi-platform health check
router.get("/platforms/check-health", async (req, res) => {
  try {
    const [platforms] = await pool.execute(
      `SELECT * FROM external_platforms WHERE user_id = ?`,
      [req.session.user.id]
    );

    const health = await Promise.all(platforms.map(async (platform) => {
      try {
        const response = await fetch(`${platform.url}/health`, {
          headers: { 'Authorization': `Bearer ${platform.api_key}` }
        });
        const status = response.ok ? 'online' : 'offline';
        
        // Mettre à jour le status
        await pool.execute(
          `UPDATE external_platforms SET status = ?, last_check = NOW() WHERE id = ?`,
          [status, platform.id]
        );
        
        return { name: platform.name, status, url: platform.url };
      } catch (e) {
        return { name: platform.name, status: 'error', error: e.message };
      }
    }));

    res.json({ platforms: health });
  } catch (e) {
    logger.error({ event: 'platform_health_check_error', error: e.message }, '[ADMIN]');
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /watchlog/active-sources - Active sources monitoring
router.get("/watchlog/active-sources", async (req, res) => {
  try {
    const userId = req.session.user.id;
    
    // Récupérer les sources ayant importé des logs dans les 24 dernières heures
    const [sources] = await pool.execute(
      `SELECT ij.import_source,
        COUNT(l.id) AS log_count,
        MAX(ij.completed_at) AS last_import,
        COUNT(DISTINCT l.log_level) AS level_diversity
       FROM import_jobs ij
       LEFT JOIN logs l ON l.import_job_id = ij.id AND l.user_id = ij.user_id
       WHERE ij.user_id = ?
         AND ij.completed_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
         AND ij.status = 'completed'
       GROUP BY ij.import_source
       ORDER BY last_import DESC`,
      [userId]
    );

    res.json({
      success: true,
      activeSources: sources.map(source => ({
        name: source.import_source,
        logsCount: source.log_count,
        lastImport: source.last_import,
        status: new Date() - new Date(source.last_import) < 3600000 ? 'active' : 'inactive',
        diversity: source.level_diversity
      }))
    });
  } catch (e) {
    logger.error({ event: 'active_sources_error', error: e.message }, '[ADMIN]');
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /share/email - Share logs via email
router.post("/share/email", async (req, res) => {
  try {
    const { emailTo, logIds, subject } = req.body;
    const userId = req.session.user.id;

    const result = await shareLogsByEmail(userId, emailTo, logIds, subject);
    res.json(result);
  } catch (e) {
    logger.error({ event: 'email_share_error', error: e.message }, '[ADMIN]');
    res.status(500).json({ error: e.message || 'Erreur serveur' });
  }
});

// POST /share/whatsapp - Share logs via WhatsApp
router.post("/share/whatsapp", async (req, res) => {
  try {
    const { phoneNumber, logIds, message } = req.body;
    const userId = req.session.user.id;

    const result = await shareLogsByWhatsApp(userId, phoneNumber, logIds, message);
    res.json(result);
  } catch (e) {
    logger.error({ event: 'whatsapp_share_error', error: e.message }, '[ADMIN]');
    res.status(500).json({ error: e.message || 'Erreur serveur' });
  }
});

router.post("/retention/run", async (req, res) => {
  try {
    const result = await runRetention();
    await recordAudit({
      userId: req.session.user.id,
      userEmail: req.session.user.email,
      action: "run_retention",
      resourceType: "system",
      details: "Manual retention run",
      ipAddress: req.ip,
    });
    res.json(result);
  } catch (e) {
    logger.error({ event: 'admin_retention_run_error', error: e.message }, '[ADMIN]');
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── PURGE ─────────────────────────────────────────────

function buildPurgeFilters({ log_level, date_from, date_before }) {
  const conditions = [];
  const params = [];
  const referenceConditions = [];
  const referenceParams = [];

  if (log_level) {
    conditions.push("log_level = ?");
    params.push(log_level);
    referenceConditions.push("l.log_level = ?");
    referenceParams.push(log_level);
  }
  if (date_from) {
    conditions.push("timestamp >= ?");
    params.push(date_from);
    referenceConditions.push("l.timestamp >= ?");
    referenceParams.push(date_from);
  }
  if (date_before) {
    conditions.push("timestamp < ?");
    params.push(date_before);
    referenceConditions.push("l.timestamp < ?");
    referenceParams.push(date_before);
  }

  return {
    where: conditions.length ? conditions.join(" AND ") : "1=1",
    params,
    referenceWhere: referenceConditions.length ? referenceConditions.join(" AND ") : "1=1",
    referenceParams,
  };
}

router.post("/purge/preview", validateBody(purgeSchema), async (req, res) => {
  try {
    const filters = buildPurgeFilters(req.body);
    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS matching FROM logs WHERE ${filters.where}`,
      filters.params
    );
    res.json({ matching: Number(rows[0]?.matching) || 0, scope: "all_users" });
  } catch (e) {
    logger.error({ event: 'admin_log_purge_preview_error', error: e.message }, '[ADMIN]');
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/purge", validateBody(purgeSchema), async (req, res) => {
  let conn;
  let transactionStarted = false;
  let deletedErrorGroups = 0;
  try {
    const { log_level, date_from, date_before } = req.body;
    const filters = buildPurgeFilters(req.body);

    conn = await pool.getConnection();
    await conn.beginTransaction();
    transactionStarted = true;

    // Vérifier si la colonne sample_log_id existe dans error_groups
    const [colCheck] = await conn.execute(
      `SELECT COUNT(*) as cnt FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'error_groups' AND column_name = 'sample_log_id'`
    );
    const hasSampleLogId = colCheck[0].cnt > 0;

    // error_groups keeps a sample_log_id pointing into logs. Detach references
    // before deleting rows so production schemas with a restrictive FK can purge.
    // Ignorer si la colonne n'existe pas (idempotent)
    if (hasSampleLogId) {
      try {
        await conn.execute(
          `UPDATE error_groups eg
           JOIN logs l ON l.id = eg.sample_log_id
           SET eg.sample_log_id = NULL
          WHERE ${filters.referenceWhere}`,
          filters.referenceParams
        );
      } catch (detachError) {
        // Ignorer l'erreur de détachement (la purge des logs peut quand même réussir)
        logger.warn({ event: 'purge_detach_skipped', error: detachError.message }, '[ADMIN]');
      }
    }

    const [result] = await conn.execute(
      `DELETE FROM logs WHERE ${filters.where}`,
      filters.params
    );

    // Remove derived groups with no remaining source log for the same tenant.
    // Ignorer si la table error_groups n'existe pas ou a une structure différente
    try {
      const [groupResult] = await conn.execute(
        `DELETE eg FROM error_groups eg
         WHERE NOT EXISTS (
           SELECT 1 FROM logs l
           WHERE l.fingerprint = eg.fingerprint
             AND l.user_id <=> eg.user_id
         )`
      );
      deletedErrorGroups = Number(groupResult.affectedRows) || 0;
    } catch (groupError) {
      // Ignorer l'erreur de nettoyage des groupes (la purge des logs a réussi)
      logger.warn({ event: 'purge_groups_skipped', error: groupError.message }, '[ADMIN]');
    }

    await conn.commit();
    transactionStarted = false;
    await invalidateAllDashboards();

    await recordAudit({
      userId: req.session.user.id,
      userEmail: req.session.user.email,
      action: "purge_logs",
      resourceType: "logs",
      details: {
        deleted: result.affectedRows,
        deletedErrorGroups,
        logLevel: log_level || null,
        dateFrom: date_from || null,
        dateBefore: date_before || null,
      },
      ipAddress: req.ip,
    });

    res.json({ deleted: result.affectedRows });
  } catch (e) {
    if (transactionStarted && conn) {
      try { await conn.rollback(); } catch (_) { /* preserve the original purge error */ }
    }
    logger.error({ event: 'admin_log_purge_error', error: e.message, code: e.code }, '[ADMIN]');
    res.status(500).json({ error: "Erreur serveur" });
  } finally {
    if (conn) conn.release();
  }
});

// ─── SYSTEM STATS ──────────────────────────────────────

router.get("/system-stats", async (req, res) => {
  try {
    const processMemory = process.memoryUsage();
    let disk = null;
    try {
      const fileSystem = await statfs(process.cwd());
      const totalBytes = Number(fileSystem.blocks) * Number(fileSystem.bsize);
      const availableBytes = Number(fileSystem.bavail) * Number(fileSystem.bsize);
      if (totalBytes > 0) {
        disk = {
          totalMb: Math.round(totalBytes / 1024 / 1024),
          availableMb: Math.round(availableBytes / 1024 / 1024),
          usedPercent: Math.round(((totalBytes - availableBytes) / totalBytes) * 100)
        };
      }
    } catch (error) {
      logger.warn({ event: 'disk_stats_unavailable', error: error.message }, '[ADMIN]');
    }

    const [users] = await pool.execute("SELECT COUNT(*) as cnt FROM users");
    const [dbSize] = await pool.execute(
      "SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) as size_mb FROM information_schema.tables WHERE table_schema = DATABASE()",
    );

    // Métriques globales sur les logs orphelins (Admin)
    const [orphanData] = await pool.execute(
      "SELECT COUNT(*) as cnt, MAX(imported_at) as last_import FROM logs WHERE user_id IS NULL"
    );

    // État du Watcher
    const { getWatcherStatus } = await import("../services/watcherService.js");
    const watcherStatus = getWatcherStatus();

    // État du Cache (Redis)
    const { getCacheStatus } = await import("../services/cacheService.js").catch(() => ({ 
      getCacheStatus: () => Promise.resolve({ connected: false }) 
    }));
    
    let cacheStatus = { connected: false };
    try {
      if (typeof getCacheStatus === 'function') {
        cacheStatus = await getCacheStatus();
      }
    } catch (e) {
      logger.warn({ event: 'redis_status_check_failed', error: e.message }, '[ADMIN]');
      cacheStatus = { connected: false };
    }

    const [totalLogs] = await pool.execute(
      "SELECT COUNT(*) as cnt FROM logs"
    );

    let openErrorGroups = [{ cnt: 0 }];
    try {
      [openErrorGroups] = await pool.execute(
        "SELECT COUNT(*) as cnt FROM error_groups WHERE status = 'open'"
      );
    } catch (_) { /* table may not exist yet */ }

    res.json({
      totalUsers: users[0].cnt,
      dbSizeMb: dbSize[0].size_mb || 0,
      orphanLogs: orphanData[0].cnt,
      lastOrphanImport: orphanData[0].last_import,
      orphanLogsAgeMinutes: orphanData[0].last_import
        ? Math.floor((Date.now() - new Date(orphanData[0].last_import).getTime()) / 60000)
        : null,
      watcherRunning: watcherStatus.running,
      activeWatchers: watcherStatus.running ? watcherStatus.dirs.length : 0, // Number of *active* configured directories
      unmappedWatchDirectories: watcherStatus.unmapped_dirs || 0,
      redisConnected: Boolean(cacheStatus.connected),
      databaseConnected: true,
      disk,
      processMemoryMb: {
        rss: Math.round(processMemory.rss / 1024 / 1024),
        heapUsed: Math.round(processMemory.heapUsed / 1024 / 1024),
        heapTotal: Math.round(processMemory.heapTotal / 1024 / 1024)
      },
      totalLogs: totalLogs[0].cnt,
      openErrorGroups: openErrorGroups[0].cnt,
      watchedFiles: watcherStatus.watched_files,
      inflightProcesses: watcherStatus.inflight
      // watcherErrors24h: 0, // Placeholder for future implementation
    });
  } catch (e) {
    logger.error({ event: 'system_stats_error', error: e.message }, '[ADMIN]');
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /alert-rules/seed-defaults — insérer les règles d'alerte par défaut
router.post("/alert-rules/seed-defaults", async (req, res) => {
  try {
    const userId = req.session.user.id;
    const [existing] = await pool.execute(
      "SELECT COUNT(*) as cnt FROM alert_rules WHERE created_by = ? OR is_global = 1",
      [userId]
    );
    if (existing[0].cnt > 0) {
      return res.json({ success: true, message: "Règles déjà existantes", seeded: 0 });
    }

    const defaults = [
      { name: "Erreurs critiques", description: "Alerte quand des logs CRITICAL ou FATAL sont détectés", condition_type: "level", condition_value: "CRITICAL,FATAL", threshold_value: 1, time_window_minutes: 5, severity: "critical", cooldown_minutes: 15, is_global: 0 },
      { name: "Pic d'erreurs", description: "Alerte si + de 10 erreurs en 10 minutes", condition_type: "error_rate", condition_value: "ERROR", threshold_value: 10, time_window_minutes: 10, severity: "high", cooldown_minutes: 30, is_global: 0 },
      { name: "Volume anormal", description: "Alerte si anomalie de volume détectée", condition_type: "anomaly", condition_value: "volume", threshold_value: null, time_window_minutes: 60, severity: "medium", cooldown_minutes: 60, is_global: 0 },
      { name: "Inactivité des logs", description: "Alerte si aucun log reçu depuis 2 heures", condition_type: "log_inactivity", condition_value: "2h", threshold_value: 120, time_window_minutes: 120, severity: "medium", cooldown_minutes: 120, is_global: 0 },
    ];

    let seeded = 0;
    for (const rule of defaults) {
      await pool.execute(
        `INSERT IGNORE INTO alert_rules (name, description, condition_type, condition_value, threshold_value, time_window_minutes, severity, cooldown_minutes, is_active, is_global, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [rule.name, rule.description, rule.condition_type, rule.condition_value, rule.threshold_value, rule.time_window_minutes, rule.severity, rule.cooldown_minutes, rule.is_global, userId]
      );
      seeded++;
    }

    await recordAudit({ userId, userEmail: req.session.user.email, action: "seed_default_rules", resourceType: "alert_rules", details: `Seeded ${seeded} default alert rules`, ipAddress: req.ip });
    res.json({ success: true, seeded, message: `${seeded} règles par défaut créées` });
  } catch (e) {
    logger.error({ event: "seed_defaults_error", error: e.message });
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── DATABASE STATS ────────────────────────────────────────

router.get('/db-stats', async (req, res) => {
  try {
    // Get table sizes
    const [tableSizes] = await pool.execute(`
      SELECT 
        table_name,
        table_rows,
        ROUND((data_length / 1024 / 1024), 2) AS data_mb,
        ROUND((index_length / 1024 / 1024), 2) AS index_mb,
        ROUND(((data_length + index_length) / 1024 / 1024), 2) AS total_mb
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
      ORDER BY (data_length + index_length) DESC
    `);

    // Get database size
    const [dbSize] = await pool.execute(`
      SELECT 
        ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS total_size_mb
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
    `);

    // Get connection pool stats
    const poolStats = {
      current: pool.pool._allConnections?.length || 0,
      max_used: pool.pool._allConnections?.length || 0
    };

    res.json({
      success: true,
      tables: tableSizes,
      total_size_mb: dbSize[0]?.total_size_mb || 0,
      connections: poolStats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error({ event: 'db_stats_error', error: error.message });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
