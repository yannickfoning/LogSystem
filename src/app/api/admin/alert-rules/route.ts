import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import z from 'zod';

const createRuleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  conditionType: z.enum(['level', 'count', 'fingerprint', 'threshold', 'silence']),
  conditionValue: z.string().min(1),
  thresholdValue: z.number().int().optional().nullable(),
  timeWindowMinutes: z.number().int().positive().default(5),
  severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  cooldownMinutes: z.number().int().positive().default(30),
  isActive: z.boolean().default(true),
});

export async function GET() {
  try {
    await requireAdmin();
    const rules = await db.alertRule.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { alerts: true } },
      },
    });

    return NextResponse.json(rules);
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden: Admin access required') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('Alert rules list error:', error);
    return NextResponse.json({ error: 'Failed to load alert rules' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = await request.json();
    const parsed = createRuleSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
    }

    const rule = await db.alertRule.create({
      data: parsed.data,
    });

    return NextResponse.json(rule, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden: Admin access required') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('Create alert rule error:', error);
    return NextResponse.json({ error: 'Failed to create alert rule' }, { status: 500 });
  }
}
