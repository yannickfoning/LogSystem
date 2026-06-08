import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import crypto from 'crypto';
import { db } from './db';

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  throw new Error('[FATAL] SESSION_SECRET must be set and at least 32 characters');
}

const SALT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
const TOKEN_VERSION = 1;
const SESSION_COOKIE = 'logsystem_session';

// ── Password helpers ──────────────────────────────────────────────────────────
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ── Session token (HMAC-SHA256, cookie-based only — NO localStorage) ─────────
function hmacSign(payload: string): string {
  return crypto.createHmac('sha256', SESSION_SECRET!).update(payload).digest('hex');
}

export function createSessionToken(userId: string, sessionVersion: number): string {
  const payload = JSON.stringify({ userId, version: sessionVersion, v: TOKEN_VERSION, ts: Date.now() });
  const encoded = Buffer.from(payload).toString('base64url');
  const sig = hmacSign(encoded);
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string): { userId: string; version: number } | null {
  try {
    const dot = token.lastIndexOf('.');
    if (dot < 0) return null;
    const encoded = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(hmacSign(encoded)))) return null;
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8'));
    if (!payload.userId || payload.version === undefined) return null;
    return { userId: payload.userId, version: payload.version };
  } catch { return null; }
}

// ── Cookie management ─────────────────────────────────────────────────────────
export async function setSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8, // 8h
  });
}
export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
}
export async function getSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE)?.value ?? null;
}

// ── Auth helpers ──────────────────────────────────────────────────────────────
export async function createSession(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('User not found');
  const token = createSessionToken(user.id, user.sessionVersion);
  await setSessionCookie(token);
  return token;
}

export async function getAuthUser() {
  const token = await getSessionToken();
  if (!token) return null;
  const decoded = verifySessionToken(token);
  if (!decoded) return null;
  const user = await db.user.findUnique({ where: { id: decoded.userId } });
  if (!user || !user.isActive) return null;
  if (user.sessionVersion !== decoded.version) return null;
  return {
    id: user.id, email: user.email, displayName: user.displayName,
    role: user.role, isActive: user.isActive, sessionVersion: user.sessionVersion,
  };
}

export async function requireAuth() {
  const user = await getAuthUser();
  if (!user) throw new Error('Unauthorized');
  return user;
}
export async function requireAdmin() {
  const user = await requireAuth();
  if (user.role !== 'admin') throw new Error('Forbidden: Admin access required');
  return user;
}
export async function requireAdminOrAnalyst() {
  const user = await requireAuth();
  if (!['admin', 'analyst'].includes(user.role)) throw new Error('Forbidden: Insufficient role');
  return user;
}

export function isAuthError(e: unknown): boolean {
  return e instanceof Error && (e.message === 'Unauthorized' || e.message.startsWith('Forbidden'));
}
