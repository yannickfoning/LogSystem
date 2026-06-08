import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin, isAuthError } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { getClientIp } from '@/lib/request-utils';
import { z } from 'zod';

const schema = z.object({
  level: z.string().optional(),
  olderThanDays: z.number().int().min(1).max(3650),
  userId: z.string().optional(), // optionnel: scoper la purge à un utilisateur
});

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

    const { level, olderThanDays, userId } = parsed.data;
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

    const result = await db.log.deleteMany({
      where: {
        timestamp: { lt: cutoff },
        ...(level ? { logLevel: level } : {}),
        ...(userId ? { userId } : {}),  // Scope optionnel par utilisateur
      },
    });

    await recordAudit({
      userId: admin.id,
      userEmail: admin.email,
      action: 'log_purge',
      resourceType: 'logs',
      details: { level, olderThanDays, targetUserId: userId, deleted: result.count },
      ipAddress: getClientIp(request),
    });

    return NextResponse.json({ deleted: result.count, success: true });
  } catch (e) {
    if (isAuthError(e)) return NextResponse.json({ error: (e as Error).message }, { status: 403 });
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
