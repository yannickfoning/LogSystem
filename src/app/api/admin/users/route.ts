import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin, hashPassword, isAuthError } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { getClientIp } from '@/lib/request-utils';
import { z } from 'zod';

const createSchema = z.object({
  email: z.string().email('Email invalide'),
  password: z.string()
    .min(12, 'Minimum 12 caractères')
    .regex(/[A-Z]/, 'Au moins une majuscule')
    .regex(/[a-z]/, 'Au moins une minuscule')
    .regex(/\d/, 'Au moins un chiffre'),
  displayName: z.string().optional(),
  role: z.enum(['admin', 'analyst', 'user']).default('user'),
});

export async function GET() {
  try {
    const admin = await requireAdmin();
    const users = await db.user.findMany({
      select: { id: true, email: true, displayName: true, role: true, isActive: true, lastLogin: true, lastIp: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(users);
  } catch (e) {
    if (isAuthError(e)) return NextResponse.json({ error: (e as Error).message }, { status: 403 });
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const body = await request.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

    const { email, password, displayName, role } = parsed.data;
    const existing = await db.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) return NextResponse.json({ error: 'Email déjà utilisé' }, { status: 409 });

    const user = await db.user.create({
      data: { email: email.toLowerCase(), passwordHash: await hashPassword(password), displayName, role },
    });

    await recordAudit({ userId: admin.id, userEmail: admin.email, action: 'user_create', resourceType: 'user', resourceId: user.id, details: { email, role }, ipAddress: getClientIp(request) });

    return NextResponse.json({ id: user.id, email: user.email, role: user.role });
  } catch (e) {
    if (isAuthError(e)) return NextResponse.json({ error: (e as Error).message }, { status: 403 });
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
