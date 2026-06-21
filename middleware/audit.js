import pool from '../config/database.js';
import logger from '../config/logger.js';

/**
 * Audit trail — records all significant platform events.
 * 
 * Required actions per spec (point 11):
 *   login, logout, import, delete, export,
 *   user_create, user_update, alert_create, alert_update,
 *   admin_action, password_change, audit_log_read
 */
export async function recordAudit({ userId, userEmail, action, resourceType, resourceId, details, ipAddress, status: _status = 'success' }) {
  try {
    const detailStr = details
      ? (typeof details === 'string' ? details : JSON.stringify(details))
      : null;

    await pool.execute(
      `INSERT INTO audit_log
         (user_id, user_email, action, resource_type, resource_id, details, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId   || null,
        userEmail || null,
        action   || '',
        resourceType || null,
        resourceId !== undefined ? String(resourceId) : null,
        detailStr ? detailStr.substring(0, 2000) : null,
        ipAddress || null
      ]
    );
  } catch (e) {
    logger.error({ event: 'audit_log_write_failed', error: e.message }, '[AUDIT]');
  }
}

/**
 * Express middleware factory — auto-records audit after response.
 * Usage: router.post('/endpoint', auditMiddleware('import', 'file'), handler)
 */
export function auditMiddleware(action, resourceType) {
  return (req, res, next) => {
    const origJson = res.json.bind(res);
    res.json = (body) => {
      const user = req.session?.user;
      const status = res.statusCode < 400 ? 'success' : 'failure';
      recordAudit({
        userId: user?.id,
        userEmail: user?.email,
        action,
        resourceType,
        resourceId: req.params?.id || body?.id || null,
        details: { status, method: req.method, path: req.path },
        ipAddress: req.ip
      }).catch(() => {});
      return origJson(body);
    };
    next();
  };
}

/**
 * Read audit logs (admin only).
 */
export async function getAuditLogs(req, limit = 100, offset = 0) {
  const user = req.session?.user;
  if (!user) throw new Error('Authentication required');
  if (user.role !== 'admin') throw new Error('Admin access required');

  await recordAudit({
    userId: user.id,
    userEmail: user.email,
    action: 'audit_log_read',
    resourceType: 'audit_log',
    ipAddress: req.ip
  });

  const [rows] = await pool.execute(
    `SELECT al.*, u.display_name
       FROM audit_log al
       LEFT JOIN users u ON u.id = al.user_id
      ORDER BY al.created_at DESC
      LIMIT ? OFFSET ?`,
    [Math.min(parseInt(limit) || 100, 500), parseInt(offset) || 0]
  );

  return rows;
}
