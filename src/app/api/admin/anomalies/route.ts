import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { detectAnomalies } from '@/lib/anomaly-detector';

export async function GET() {
  try {
    await requireAdmin();

    const anomalies = await db.anomaly.findMany({
      orderBy: { detectedAt: 'desc' },
      take: 100,
    });

    return NextResponse.json(anomalies);
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden: Admin access required') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('Anomalies list error:', error);
    return NextResponse.json({ error: 'Failed to load anomalies' }, { status: 500 });
  }
}

export async function POST() {
  try {
    await requireAdmin();
    const result = await detectAnomalies();
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden: Admin access required') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('Run anomaly detection error:', error);
    return NextResponse.json({ error: 'Failed to run anomaly detection' }, { status: 500 });
  }
}
