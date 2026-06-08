import { db } from './db';
import { isErrorLevel, getLevelPriority } from './processing/levels';
import os from 'os';

interface AlertEvaluationResult {
  triggered: boolean;
  alertsCreated: number;
  details: string[];
}

export async function evaluateAlertRules(): Promise<AlertEvaluationResult> {
  const rules = await db.alertRule.findMany({ where: { isActive: true } });
  const details: string[] = [];
  let alertsCreated = 0;

  for (const rule of rules) {
    try {
      const result = await evaluateRule(rule);
      if (result.triggered) {
        alertsCreated += result.alertsCreated;
        details.push(`Rule "${rule.name}" triggered: ${result.alertsCreated} alerts created`);
      }
    } catch (error) {
      details.push(`Rule "${rule.name}" evaluation error: ${error}`);
    }
  }

  return {
    triggered: alertsCreated > 0,
    alertsCreated,
    details,
  };
}

async function evaluateRule(rule: {
  id: string;
  name: string;
  conditionType: string;
  conditionValue: string;
  thresholdValue: number | null;
  timeWindowMinutes: number;
  severity: string;
  cooldownMinutes: number;
}): Promise<{ triggered: boolean; alertsCreated: number }> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - rule.timeWindowMinutes * 60 * 1000);
  const cooldownStart = new Date(now.getTime() - rule.cooldownMinutes * 60 * 1000);

  // Check cooldown - if a recent alert exists for this rule, skip
  const recentAlert = await db.alert.findFirst({
    where: {
      ruleId: rule.id,
      createdAt: { gte: cooldownStart },
    },
  });
  if (recentAlert) {
    return { triggered: false, alertsCreated: 0 };
  }

  switch (rule.conditionType) {
    case 'level': {
      return await evaluateLevelRule(rule, windowStart);
    }
    case 'count': {
      return await evaluateCountRule(rule, windowStart);
    }
    case 'fingerprint': {
      return await evaluateFingerprintRule(rule, windowStart);
    }
    case 'threshold': {
      return await evaluateThresholdRule(rule, windowStart);
    }
    case 'silence': {
      return await evaluateSilenceRule(rule, windowStart);
    }
    default:
      return { triggered: false, alertsCreated: 0 };
  }
}

async function evaluateLevelRule(
  rule: { id: string; name: string; conditionValue: string; severity: string },
  windowStart: Date
): Promise<{ triggered: boolean; alertsCreated: number }> {
  const level = rule.conditionValue.toUpperCase();
  const minPriority = getLevelPriority(level);

  const count = await db.log.count({
    where: {
      timestamp: { gte: windowStart },
    },
  });

  // Get all logs in window and filter by level priority
  const recentLogs = await db.log.findMany({
    where: {
      timestamp: { gte: windowStart },
      logLevel: { in: ['ERROR', 'CRITICAL', 'FATAL', 'WARNING', 'INFO', 'DEBUG'] },
    },
    select: { logLevel: true },
  });

  const matchingCount = recentLogs.filter(l => getLevelPriority(l.logLevel) >= minPriority).length;

  if (matchingCount > 0) {
    await db.alert.create({
      data: {
        alertType: 'level',
        severity: rule.severity,
        message: `${matchingCount} log(s) with level >= ${level} detected`,
        ruleId: rule.id,
        metadata: JSON.stringify({ level, count: matchingCount }),
      },
    });
    return { triggered: true, alertsCreated: 1 };
  }

  return { triggered: false, alertsCreated: 0 };
}

async function evaluateCountRule(
  rule: { id: string; name: string; conditionValue: string; thresholdValue: number | null; severity: string },
  windowStart: Date
): Promise<{ triggered: boolean; alertsCreated: number }> {
  const level = rule.conditionValue.toUpperCase();
  const threshold = rule.thresholdValue || 10;

  if (['SECURITY', 'AUTH'].includes(level)) {
    const matchingCount = await db.log.count({
      where: {
        timestamp: { gte: windowStart },
        OR: [
          { eventType: { contains: level.toLowerCase() } },
          { message: { contains: level } },
          { normalizedMessage: { contains: level.toLowerCase() } },
        ],
      },
    });

    if (matchingCount >= threshold) {
      await db.alert.create({
        data: {
          alertType: level.toLowerCase(),
          severity: rule.severity,
          message: `${matchingCount} ${level} event(s) detected (threshold ${threshold})`,
          ruleId: rule.id,
          metadata: JSON.stringify({ type: level, count: matchingCount, threshold }),
        },
      });
      return { triggered: true, alertsCreated: 1 };
    }

    return { triggered: false, alertsCreated: 0 };
  }

  const recentLogs = await db.log.findMany({
    where: {
      timestamp: { gte: windowStart },
      logLevel: { in: ['ERROR', 'CRITICAL', 'FATAL', 'WARNING', 'INFO', 'DEBUG'] },
    },
    select: { logLevel: true },
  });

  const matchingCount = recentLogs.filter(l => {
    if (level === 'ANY') return true;
    return getLevelPriority(l.logLevel) >= getLevelPriority(level);
  }).length;

  if (matchingCount >= threshold) {
    await db.alert.create({
      data: {
        alertType: 'count',
        severity: rule.severity,
        message: `${matchingCount} log(s) exceeding threshold ${threshold} for ${level}`,
        ruleId: rule.id,
        metadata: JSON.stringify({ level, count: matchingCount, threshold }),
      },
    });
    return { triggered: true, alertsCreated: 1 };
  }

  return { triggered: false, alertsCreated: 0 };
}

async function evaluateFingerprintRule(
  rule: { id: string; name: string; conditionValue: string; severity: string },
  windowStart: Date
): Promise<{ triggered: boolean; alertsCreated: number }> {
  const fingerprint = rule.conditionValue;

  const count = await db.log.count({
    where: {
      fingerprint,
      timestamp: { gte: windowStart },
    },
  });

  if (count > 0) {
    await db.alert.create({
      data: {
        alertType: 'fingerprint',
        severity: rule.severity,
        message: `Error group ${fingerprint} has ${count} occurrence(s)`,
        ruleId: rule.id,
        metadata: JSON.stringify({ fingerprint, count }),
      },
    });
    return { triggered: true, alertsCreated: 1 };
  }

  return { triggered: false, alertsCreated: 0 };
}

async function evaluateThresholdRule(
  rule: { id: string; name: string; conditionValue: string; thresholdValue: number | null; severity: string },
  windowStart: Date
): Promise<{ triggered: boolean; alertsCreated: number }> {
  const targetLevel = rule.conditionValue.toUpperCase();
  const threshold = rule.thresholdValue || 100;

  if (targetLevel === 'DISK') {
    const diskLogs = await db.log.findMany({
      where: {
        timestamp: { gte: windowStart },
        OR: [
          { eventType: { contains: 'disk' } },
          { message: { contains: 'disk' } },
          { message: { contains: 'space' } },
          { message: { contains: 'storage' } },
        ],
      },
      select: { id: true, message: true, sourceDirectory: true },
      take: 50,
    });

    const matching = diskLogs
      .map((log) => ({ log, usage: extractPercent(log.message) }))
      .filter((item) => item.usage !== null && item.usage >= threshold);

    if (matching.length > 0) {
      await db.alert.create({
        data: {
          alertType: 'disk',
          severity: rule.severity,
          message: `Disk usage threshold exceeded: ${matching[0].usage}% (threshold ${threshold}%)`,
          ruleId: rule.id,
          sourceDirectory: matching[0].log.sourceDirectory || null,
          metadata: JSON.stringify({ threshold, matches: matching.slice(0, 5) }),
        },
      });
      return { triggered: true, alertsCreated: 1 };
    }

    const total = os.totalmem();
    const usedPercent = total > 0 ? Math.round(((total - os.freemem()) / total) * 100) : 0;
    if (usedPercent >= threshold) {
      await db.alert.create({
        data: {
          alertType: 'disk',
          severity: rule.severity,
          message: `System resource usage threshold exceeded: ${usedPercent}% (threshold ${threshold}%)`,
          ruleId: rule.id,
          metadata: JSON.stringify({ threshold, usedPercent, source: 'system_memory_fallback' }),
        },
      });
      return { triggered: true, alertsCreated: 1 };
    }

    return { triggered: false, alertsCreated: 0 };
  }

  const count = await db.log.count({
    where: {
      timestamp: { gte: windowStart },
    },
  });

  const recentLogs = await db.log.findMany({
    where: {
      timestamp: { gte: windowStart },
      logLevel: { in: ['ERROR', 'CRITICAL', 'FATAL', 'WARNING', 'INFO', 'DEBUG'] },
    },
    select: { logLevel: true },
  });

  const matchingCount = recentLogs.filter(l => getLevelPriority(l.logLevel) >= getLevelPriority(targetLevel)).length;

  if (matchingCount >= threshold) {
    await db.alert.create({
      data: {
        alertType: 'threshold',
        severity: rule.severity,
        message: `${targetLevel}+ log threshold (${threshold}) exceeded: ${matchingCount} events`,
        ruleId: rule.id,
        metadata: JSON.stringify({ level: targetLevel, count: matchingCount, threshold }),
      },
    });
    return { triggered: true, alertsCreated: 1 };
  }

  return { triggered: false, alertsCreated: 0 };
}

function extractPercent(message: string): number | null {
  const match = message.match(/(\d{1,3})(?:\.\d+)?\s*%/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

async function evaluateSilenceRule(
  rule: { id: string; name: string; conditionValue: string; thresholdValue: number | null; severity: string; timeWindowMinutes: number },
  windowStart: Date
): Promise<{ triggered: boolean; alertsCreated: number }> {
  const expectedMinLogs = rule.thresholdValue || 1;

  const count = await db.log.count({
    where: {
      timestamp: { gte: windowStart },
      source: rule.conditionValue || undefined,
    },
  });

  if (count < expectedMinLogs) {
    await db.alert.create({
      data: {
        alertType: 'silence',
        severity: rule.severity,
        message: `Source "${rule.conditionValue}" has been silent: only ${count} log(s) in ${rule.timeWindowMinutes}min (expected >= ${expectedMinLogs})`,
        ruleId: rule.id,
        metadata: JSON.stringify({ source: rule.conditionValue, count, expected: expectedMinLogs }),
      },
    });
    return { triggered: true, alertsCreated: 1 };
  }

  return { triggered: false, alertsCreated: 0 };
}
