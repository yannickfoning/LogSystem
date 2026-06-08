import { NextResponse } from 'next/server';
import { clearSessionCookie, getAuthUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { getClientIp } from '@/lib/request-utils';

export async function POST(request: Request) {
  try {
    const user = await getAuthUser();
    
    // Log audit event
    if (user) {
      await db.auditLog.create({
        data: {
          userId: user.id,
          userEmail: user.email,
          action: 'logout',
          resourceType: 'session',
          ipAddress: getClientIp(request),
        },
      });
    }

    await clearSessionCookie();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json({ error: 'Logout failed' }, { status: 500 });
  }
}
