import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';

export async function PUT() {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Mark all unread alerts as read for this user (including system alerts)
    const whereBase = user.role === 'admin'
      ? { readAt: null }
      : { OR: [{ userId: user.id }, { userId: null }], readAt: null };

    const result = await db.alert.updateMany({
      where: whereBase,
      data: { readAt: new Date() },
    });

    return NextResponse.json({ updated: result.count });
  } catch (error) {
    console.error('Read all alerts error:', error);
    return NextResponse.json({ error: 'Failed to mark alerts as read' }, { status: 500 });
  }
}
