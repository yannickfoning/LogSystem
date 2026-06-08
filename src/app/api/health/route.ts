import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    await db.$queryRaw('SELECT 1');
    return NextResponse.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString(), version: '5.0.0' });
  } catch {
    return NextResponse.json({ status: 'error', database: 'disconnected' }, { status: 503 });
  }
}
