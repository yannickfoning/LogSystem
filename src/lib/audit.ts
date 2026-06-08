import { db } from './db';

interface AuditOptions {
  userId?: string | null;
  userEmail?: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown> | string | null;
  ipAddress?: string | null;
  status?: 'success' | 'failure';
}

export async function recordAudit(opts: AuditOptions): Promise<void> {
  try {
    const detailStr = opts.details
      ? (typeof opts.details === 'string' ? opts.details : JSON.stringify(opts.details))
      : null;

    await db.auditLog.create({
      data: {
        userId: opts.userId || null,
        userEmail: opts.userEmail || null,
        action: opts.action,
        resourceType: opts.resourceType || null,
        resourceId: opts.resourceId || null,
        details: detailStr ? detailStr.substring(0, 2000) : null,
        ipAddress: opts.ipAddress || null,
        status: opts.status || 'success',
      },
    });
  } catch (e) {
    console.error('[AUDIT] Failed to record audit log:', e);
  }
}
