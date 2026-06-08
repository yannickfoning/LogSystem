import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword, createSession } from '@/lib/auth';
import { z } from 'zod';

const schema = z.object({
  email: z.string().email(),
  password: z.string()
    .min(12, 'Minimum 12 caractères')
    .regex(/[A-Z]/, 'Au moins une majuscule')
    .regex(/[a-z]/, 'Au moins une minuscule')
    .regex(/\d/, 'Au moins un chiffre'),
  displayName: z.string().optional(),
});

export async function GET() {
  const count = await db.user.count();
  return NextResponse.json({ needsSetup: count === 0 });
}

export async function POST(request: Request) {
  const count = await db.user.count();
  if (count > 0) return NextResponse.json({ error: 'Configuration déjà effectuée' }, { status: 403 });
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const { email, password, displayName } = parsed.data;
  const user = await db.user.create({ data: { email: email.toLowerCase(), passwordHash: await hashPassword(password), displayName: displayName || 'Administrateur', role: 'admin' } });
  await createSession(user.id);
  return NextResponse.json({ success: true, id: user.id });
}
