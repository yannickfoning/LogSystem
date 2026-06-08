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
    const status = searchParams.get('status') || undefined;
    const severity = searchParams.get('severity') || undefined;
    const page = parseInt(searchParams.get('page') || '1') || 1;
    const limit = Math.min(parseInt(searchParams.get('limit') || '50') || 50, 200);

    // Non-admin users can see their own alerts + system alerts (userId: null)
    const whereBase = user.role === 'admin'
      ? {}
      : { OR: [{ userId: user.id }, { userId: null }] };

    const where = { ...whereBase } as any;
    if (status) where.status = status;
    if (severity) where.severity = severity;

    const [alerts, total] = await Promise.all([
      db.alert.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { rule: { select: { id: true, name: true } } },
      }),
      db.alert.count({ where }),
    ]);

    return NextResponse.json({
      alerts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Alerts list error:', error);
    return NextResponse.json({ error: 'Failed to load alerts' }, { status: 500 });
  }
}
