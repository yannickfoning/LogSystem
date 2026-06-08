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

    const topErrors = await db.errorGroup.findMany({
      where: user.role === 'admin' ? {} : { userId: user.id },
      orderBy: { occurrenceCount: 'desc' },
      take: limit,
    });

    return NextResponse.json({ topErrors });
  } catch (error) {
    console.error('Dashboard top errors error:', error);
    return NextResponse.json({ error: 'Failed to load top errors' }, { status: 500 });
  }
}
