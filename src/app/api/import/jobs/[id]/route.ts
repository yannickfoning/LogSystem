import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const whereBase = user.role === 'admin' ? { id } : { id, userId: user.id };

    const job = await db.importJob.findUnique({ where: whereBase });
    if (!job) {
      return NextResponse.json({ error: 'Import job not found' }, { status: 404 });
    }

    return NextResponse.json(job);
  } catch (error) {
    console.error('Import job detail error:', error);
    return NextResponse.json({ error: 'Failed to load import job' }, { status: 500 });
  }
}
