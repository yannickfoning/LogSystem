import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;

    const rule = await db.alertRule.findUnique({
      where: { id },
      include: {
        alerts: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });

    if (!rule) {
      return NextResponse.json({ error: 'Alert rule not found' }, { status: 404 });
    }

    return NextResponse.json(rule);
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden: Admin access required') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('Alert rule detail error:', error);
    return NextResponse.json({ error: 'Failed to load alert rule' }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = await request.json();

    const existing = await db.alertRule.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Alert rule not found' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.conditionType !== undefined) updateData.conditionType = body.conditionType;
    if (body.conditionValue !== undefined) updateData.conditionValue = body.conditionValue;
    if (body.thresholdValue !== undefined) updateData.thresholdValue = body.thresholdValue;
    if (body.timeWindowMinutes !== undefined) updateData.timeWindowMinutes = body.timeWindowMinutes;
    if (body.severity !== undefined) updateData.severity = body.severity;
    if (body.cooldownMinutes !== undefined) updateData.cooldownMinutes = body.cooldownMinutes;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;

    const updated = await db.alertRule.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden: Admin access required') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('Alert rule update error:', error);
    return NextResponse.json({ error: 'Failed to update alert rule' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;

    const existing = await db.alertRule.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Alert rule not found' }, { status: 404 });
    }

    // Delete associated alerts first
    await db.alert.deleteMany({ where: { ruleId: id } });
    await db.alertRule.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden: Admin access required') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('Alert rule delete error:', error);
    return NextResponse.json({ error: 'Failed to delete alert rule' }, { status: 500 });
  }
}
