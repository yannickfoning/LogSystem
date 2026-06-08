import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '10', 10) || 10, 50);

    const whereBase = user.role === 'admin' ? {} : { userId: user.id };

    const recentLogs = await db.log.findMany({
      where: whereBase,
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    return NextResponse.json({ logs: recentLogs, recentLogs });
  } catch (error) {
    console.error('Dashboard recent logs error:', error);
    return NextResponse.json({ error: 'Failed to load recent logs' }, { status: 500 });
  }
}
