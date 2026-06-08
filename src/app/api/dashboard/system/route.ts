import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await getAuthUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const whereBase = user.role === 'admin' ? {} : { userId: user.id };

    const [totalLogs, totalUsers, totalAlerts, activeAlerts] = await Promise.all([
      db.log.count({ where: whereBase }),
      user.role === 'admin' ? db.user.count() : Promise.resolve(1),
      db.alert.count({ where: whereBase }),
      db.alert.count({ where: { ...whereBase, status: 'new' } }),
    ]);

    return NextResponse.json({
      status: 'operational',
      database: 'MySQL (Aiven)',
      uptime: process.uptime(),
      totalLogs,
      totalUsers,
      totalAlerts,
      activeAlerts,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Dashboard system error:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
