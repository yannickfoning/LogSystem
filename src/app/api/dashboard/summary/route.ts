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

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [
      totalLogs,
      todayLogs,
      errorCount,
      fatalCount,
      criticalCount,
      unreadAlerts,
      sourceCount,
    ] = await Promise.all([
      db.log.count({ where: whereBase }),
      db.log.count({ where: { ...whereBase, timestamp: { gte: todayStart } } }),
      db.log.count({ where: { ...whereBase, logLevel: 'ERROR' } }),
      db.log.count({ where: { ...whereBase, logLevel: 'FATAL' } }),
      db.log.count({ where: { ...whereBase, logLevel: 'CRITICAL' } }),
      db.alert.count({
        where: user.role === 'admin'
          ? { status: { in: ['new', 'in_progress'] } }
          : { OR: [{ userId: user.id }, { userId: null }], status: { in: ['new', 'in_progress'] } },
      }),
      db.log.findMany({
        where: { ...whereBase, source: { not: null } },
        select: { source: true },
        distinct: ['source'],
      }),
    ]);

    // Levels breakdown
    const levelsRaw = await db.log.groupBy({
      by: ['logLevel'],
      where: whereBase,
      _count: { logLevel: true },
    });

    const levelsBreakdown: Record<string, number> = {};
    for (const l of levelsRaw) {
      levelsBreakdown[l.logLevel] = l._count.logLevel;
    }

    return NextResponse.json({
      totalLogs,
      totalErrors: errorCount + fatalCount + criticalCount,
      todayLogs,
      todayCount: todayLogs,
      infoCount: levelsBreakdown.INFO ?? 0,
      warningCount: levelsBreakdown.WARNING ?? 0,
      errorCount,
      fatalCount,
      criticalCount,
      unreadAlerts,
      sourceCount: sourceCount.length,
      userCount: user.role === 'admin' ? await db.user.count() : 1,
      levelsBreakdown,
    });
  } catch (error) {
    console.error('Dashboard summary error:', error);
    return NextResponse.json({ error: 'Failed to load summary' }, { status: 500 });
  }
}
