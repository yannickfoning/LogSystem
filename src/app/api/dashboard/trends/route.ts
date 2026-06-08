import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser, isAuthError } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const user = await getAuthUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const days = Math.min(parseInt(searchParams.get('days') || '7'), 90);
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // MySQL-compatible: group by DATE(timestamp)
    const userFilter = user.role !== 'admin' ? `AND userId = '${user.id}'` : '';
    const trends = await db.$queryRaw<Array<{ dateKey: string; total: bigint; errorCount: bigint }>>(
      `SELECT
        DATE_FORMAT(timestamp, '%Y-%m-%d') as dateKey,
        COUNT(*) as total,
        SUM(CASE WHEN logLevel IN ('ERROR', 'CRITICAL', 'FATAL') THEN 1 ELSE 0 END) as errorCount
      FROM logs
      WHERE timestamp >= ${startDate.getTime()}
      ${userFilter}
      GROUP BY DATE_FORMAT(timestamp, '%Y-%m-%d')
      ORDER BY dateKey ASC`
    );

    // Fallback to Prisma groupBy if raw query fails
    return NextResponse.json({
      trends: trends.map(t => ({ date: t.dateKey, count: Number(t.total), errorCount: Number(t.errorCount) })),
      interval: 'day', days,
    });
  } catch {
    // Fallback: use Prisma for compatibility
    try {
      const user = await getAuthUser();
      if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
      const days = 7;
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const logs = await db.log.findMany({
        where: { timestamp: { gte: startDate }, ...(user.role !== 'admin' ? { userId: user.id } : {}) },
        select: { timestamp: true, logLevel: true },
        orderBy: { timestamp: 'asc' },
      });
      const byDay: Record<string, { count: number; errorCount: number }> = {};
      for (const log of logs) {
        const key = log.timestamp.toISOString().slice(0, 10);
        if (!byDay[key]) byDay[key] = { count: 0, errorCount: 0 };
        byDay[key].count++;
        if (['ERROR', 'CRITICAL', 'FATAL'].includes(log.logLevel)) byDay[key].errorCount++;
      }
      return NextResponse.json({ trends: Object.entries(byDay).map(([date, v]) => ({ date, ...v })), interval: 'day', days });
    } catch (e2) {
      return NextResponse.json({ trends: [], interval: 'day', days: 7 });
    }
  }
}
