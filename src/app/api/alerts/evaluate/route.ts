import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { evaluateAlertRules } from '@/lib/alert-engine';

export async function POST() {
  try {
    await requireAdmin();
    const result = await evaluateAlertRules();
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && (error.message === 'Unauthorized' || error.message === 'Forbidden: Admin access required')) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error('Alert evaluate error:', error);
    return NextResponse.json({ error: 'Failed to evaluate alerts' }, { status: 500 });
  }
}
