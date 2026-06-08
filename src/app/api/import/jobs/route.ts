import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';

export async function GET() {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const whereBase = user.role === 'admin' ? {} : { userId: user.id };

    const jobs = await db.importJob.findMany({
      where: whereBase,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return NextResponse.json(jobs);
  } catch (error) {
    console.error('Import jobs list error:', error);
    return NextResponse.json({ error: 'Failed to load import jobs' }, { status: 500 });
  }
}
