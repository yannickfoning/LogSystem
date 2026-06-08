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

    const [todayLogs, todayErrors, todayWarnings, todayFatal] = await Promise.all([
      db.log.count({ where: { ...whereBase, timestamp: { gte: todayStart } } }),
      db.log.count({ where: { ...whereBase, logLevel: 'ERROR', timestamp: { gte: todayStart } } }),
      db.log.count({ where: { ...whereBase, logLevel: 'WARNING', timestamp: { gte: todayStart } } }),
      db.log.count({ where: { ...whereBase, logLevel: 'FATAL', timestamp: { gte: todayStart } } }),
    ]);

    // Hourly breakdown using MySQL HOUR function
    const timestampFilter = todayStart.getTime();
    const userFilter = user.role !== 'admin' ? `AND userId = '${user.id}'` : '';
    const hourlyData = await db.$queryRaw<
      Array<{ hour: string; count: bigint; errorCount: bigint }>
    >(
      `SELECT 
        HOUR(FROM_UNIXTIME(timestamp/1000)) as hour,
        COUNT(*) as count,
        SUM(CASE WHEN logLevel IN ('ERROR', 'CRITICAL', 'FATAL') THEN 1 ELSE 0 END) as errorCount
      FROM logs
      WHERE timestamp >= ${timestampFilter}
      ${userFilter}
      GROUP BY hour
      ORDER BY hour ASC`
    );

    const hourlyBreakdown = Array.from({ length: 24 }, (_, i) => {
      const hourStr = i.toString().padStart(2, '0');
      const match = hourlyData.find(h => h.hour === hourStr);
      return {
        hour: hourStr,
        count: match ? Number(match.count) : 0,
        errorCount: match ? Number(match.errorCount) : 0,
      };
    });

    return NextResponse.json({
      todayStats: {
        todayLogs,
        todayErrors,
        todayWarnings,
        todayFatal,
      },
      hourlyBreakdown,
    });
  } catch (error) {
    console.error('Dashboard today error:', error);
    return NextResponse.json({ error: 'Failed to load today stats' }, { status: 500 });
  }
}
