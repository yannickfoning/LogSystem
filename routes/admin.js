import { Router } from "express";
import logger from "../config/logger.js";
import bcrypt from "bcrypt";
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

const router = Router();
router.use(requireAuth, requireAdmin);

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
      "SELECT ar.*, u.email as created_by_email FROM alert_rules ar LEFT JOIN users u ON ar.created_by = u.id WHERE ar.created_by = ? ORDER BY ar.created_at DESC",
      [req.session.user.id],
    );
    res.json(rows);
  } catch (e) {
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

    res.json({ success: true, id: result.insertId });
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
      return res.status(404).json({ error: "RÃ¨gle non trouvÃ©e" });

    res.json({ success: true });
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
      return res.status(404).json({ error: "RÃ¨gle non trouvÃ©e" });
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

    res.json({ success: true });
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

    sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(limitVal, offset);

    const [rows] = await pool.execute(sql, params);

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
    const user = req.session.user;
    const stats = await getRetentionStats(user.id);
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/retention/run", async (req, res) => {
  try {
    const user = req.session.user;
    const result = await runRetention(user.id);
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
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── PURGE ─────────────────────────────────────────────

router.post("/purge", validateBody(purgeSchema), async (req, res) => {
  try {
    const { log_level, date_before } = req.body;
    const user = req.session.user;
    let sql = "DELETE FROM logs WHERE 1=1";
    const params = [user.id];
    sql += " AND user_id = ?";
    if (log_level) {
      sql += " AND log_level = ?";
      params.push(log_level);
    }
    if (date_before) {
      sql += " AND timestamp < ?";
      params.push(date_before);
    }

    const [result] = await pool.execute(sql, params);

    await recordAudit({
      userId: req.session.user.id,
      userEmail: req.session.user.email,
      action: "purge_logs",
      resourceType: "logs",
      details: `Purged ${result.affectedRows} logs`,
      ipAddress: req.ip,
    });

    res.json({ deleted: result.affectedRows });
  } catch (e) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── SYSTEM STATS ──────────────────────────────────────

router.get("/system-stats", async (req, res) => {
  try {
    const user = req.session.user;
    const scopeSql = " AND user_id = ?";
    const scopeParams = [user.id];

    const [users] = await pool.execute("SELECT COUNT(*) as cnt FROM users");
    const [dbSize] = await pool.execute(
      "SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) as size_mb FROM information_schema.tables WHERE table_schema = DATABASE()",
    );
    const [errorGroups] = await pool.execute(
      'SELECT COUNT(*) as cnt FROM error_groups WHERE status = "open" AND user_id = ?',
      [user.id],
    );
    const [alerts] = await pool.execute(
      `SELECT COUNT(*) as cnt FROM alerts WHERE status = 'new'${scopeSql}`,
      scopeParams,
    );
    const [totalLogs] = await pool.execute(
      "SELECT COUNT(*) as cnt FROM logs WHERE user_id = ?",
      scopeParams,
    );

    res.json({
      total_users: users[0].cnt,
      db_size_mb: dbSize[0].size_mb || 0,
      open_error_groups: errorGroups[0].cnt,
      new_alerts: alerts[0].cnt,
      total_logs: totalLogs[0].cnt,
      scope: "user",
    });
  } catch (e) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
