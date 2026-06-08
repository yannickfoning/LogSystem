import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyPassword, createSession } from '@/lib/auth';

const loginAttempts = new Map<string, { count: number; lastAttempt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    // Rate limiting
    const clientKey = email.toLowerCase();
    const attempts = loginAttempts.get(clientKey);
    if (attempts && attempts.count >= MAX_ATTEMPTS) {
      const elapsed = Date.now() - attempts.lastAttempt;
      if (elapsed < WINDOW_MS) {
        return NextResponse.json(
          { error: `Too many login attempts. Try again in ${Math.ceil((WINDOW_MS - elapsed) / 60000)} minutes.` },
          { status: 429 }
        );
      }
      loginAttempts.delete(clientKey);
    }

    const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) {
      incrementAttempts(clientKey);
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    if (!user.isActive) {
      return NextResponse.json({ error: 'Account is disabled' }, { status: 403 });
    }

    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      incrementAttempts(clientKey);
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    // Clear rate limit on successful login
    loginAttempts.delete(clientKey);

    // Update last login
    await db.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    // Create session
    await createSession(user.id);

    return NextResponse.json({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
    });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}

function incrementAttempts(key: string) {
  const current = loginAttempts.get(key);
  if (current) {
    current.count++;
    current.lastAttempt = Date.now();
  } else {
    loginAttempts.set(key, { count: 1, lastAttempt: Date.now() });
  }
}
