import pool from '../config/database.js';
import logger from '../config/logger.js';

export async function recordAudit({ userId, userEmail, action, resourceType, resourceId, details, ipAddress }) {
  try {
    await pool.execute(
      'INSERT INTO audit_log (user_id, user_email, action, resource_type, resource_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId || null, userEmail || null, action || '', resourceType || null, resourceId || null, details || null, ipAddress || null]
    );
  } catch (e) {
    logger.error({ event: 'audit_log_write_failed', error: e.message }, '[AUDIT]');
  }
}

// S-05: Helper to get audit logs with proper scoping
export async function getAuditLogs(req, limit = 100, offset = 0) {
  const user = req.session?.user;
  if (!user) {
    throw new Error('Authentication required');
  }

  // Only admins can read audit logs
  if (user.role !== 'admin') {
    throw new Error('Admin access required');
  }

  // S-05: Log who is accessing audit logs
  await recordAudit({
    userId: user.id,
    userEmail: user.email,
    action: 'audit_log_read',
    resourceType: 'audit_log',
    ipAddress: req.ip
  });

  const [rows] = await pool.execute(
    'SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [limit, offset]
  );

  return rows;
}
