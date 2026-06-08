import { NextResponse } from 'next/server';
import { requireAuth, verifyPassword, hashPassword, createSessionToken, setSessionCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import { getClientIp } from '@/lib/request-utils';
import z from 'zod';

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    const body = await request.json();
    const parsed = changePasswordSchema.safeParse(body);
    
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
    }

    const { currentPassword, newPassword } = parsed.data;

    // Get full user with password hash
    const fullUser = await db.user.findUnique({ where: { id: user.id } });
    if (!fullUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Verify current password
    const isValid = await verifyPassword(currentPassword, fullUser.passwordHash);
    if (!isValid) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
    }

    // Hash new password
    const newHash = await hashPassword(newPassword);
    
    // Increment session version to invalidate other sessions
    const newVersion = fullUser.sessionVersion + 1;
    
    await db.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newHash,
        sessionVersion: newVersion,
      },
    });

    // Re-issue session token with new version
    const newToken = createSessionToken(user.id, newVersion);
    await setSessionCookie(newToken);

    // Audit log
    await db.auditLog.create({
      data: {
        userId: user.id,
        userEmail: user.email,
        action: 'change_password',
        resourceType: 'user',
        resourceId: user.id,
        ipAddress: getClientIp(request),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Change password error:', error);
    return NextResponse.json({ error: 'Failed to change password' }, { status: 500 });
  }
}
