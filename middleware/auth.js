import pool from "../config/database.js";

const SESSION_VERSION_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function checkSessionVersion(req, strict = false) {
  const user = req.session?.user;
  if (!user || user.session_version === undefined) return true; // pas de version stockée → OK (rétrocompat)

  const now = Date.now();
  const lastCheck = req.session._svCheckedAt || 0;
  if (now - lastCheck < SESSION_VERSION_CACHE_TTL) return true; // vérification récente, pas besoin de re-query

  try {
    const [rows] = await pool.execute(
      "SELECT session_version FROM users WHERE id = ? AND is_active = 1",
      [user.id],
    );
    if (!rows.length || rows[0].session_version !== user.session_version) {
      return false; // version révoquée ou utilisateur désactivé
    }
    req.session._svCheckedAt = now;
    return true;
  } catch (error) {
    if (strict) {
      // Fail-closed for sensitive routes (admin, password changes, etc.)
      logger.error({
        event: 'session_validation_failed_strict',
        error: error.message,
        userId: user.id
      });
      return false;
    }
    // Fail-open for read-only routes to avoid denial of service
    logger.warn({
      event: 'session_validation_failed_lax',
      error: error.message,
      userId: user.id
    });
    return true;
  }
}

export async function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: "Authentification requise" });
  }
  const valid = await checkSessionVersion(req);
  if (!valid) {
    req.session.destroy(() => {});
    return res
      .status(401)
      .json({ error: "Session révoquée. Veuillez vous reconnecter." });
  }
  next();
}

export async function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: "Authentification requise" });
  }
  // Use strict mode for admin routes - fail-closed on DB errors
  const valid = await checkSessionVersion(req, true);
  if (!valid) {
    req.session.destroy(() => {});
    return res
      .status(401)
      .json({ error: "Session révoquée ou base de données indisponible. Veuillez vous reconnecter." });
  }
  if (req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Accès refusé. Rôle admin requis." });
  }
  next();
}

export async function requireAuthPage(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.redirect("/login.html");
  }
  const valid = await checkSessionVersion(req);
  if (!valid) {
    req.session.destroy(() => {});
    return res.redirect("/login.html");
  }
  next();
}

export async function requireAdminPage(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.redirect("/login.html");
  }
  // Use strict mode for admin pages - fail-closed on DB errors
  const valid = await checkSessionVersion(req, true);
  if (!valid) {
    req.session.destroy(() => {});
    return res.redirect("/login.html");
  }
  if (req.session.user.role !== "admin") {
    return res.redirect("/dashboard.html");
  }
  next();
}

// Strict authentication for sensitive operations (password changes, data deletion, etc.)
export async function requireAuthStrict(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: "Authentification requise" });
  }
  // Use strict mode - fail-closed on DB errors
  const valid = await checkSessionVersion(req, true);
  if (!valid) {
    req.session.destroy(() => {});
    return res
      .status(401)
      .json({ error: "Session révoquée ou base de données indisponible. Veuillez vous reconnecter." });
  }
  next();
}

export function userScope(req) {
  const user = req.session?.user;
  if (!user) {
    return { sql: " AND 1=0", params: [] }; // S-01: fail-closed when no user
  }

  // NOTE: Admin/analyst should still be scoped by user_id if your DB uses integer user_id.
  // This prevents MySQL type mismatch when session user.id is stored as string.
  if (user.role === "admin") {
    return { sql: "", params: [] }; // Admins can see everything
  }

  return { sql: " AND user_id = ?", params: [parseInt(user.id, 10)] };
}
