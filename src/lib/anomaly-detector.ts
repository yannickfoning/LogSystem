import { db } from './db';

interface AnomalyResult {
  anomaliesFound: number;
  details: string[];
}

export async function detectAnomalies(userId?: string): Promise<AnomalyResult> {
  const details: string[] = [];
  let anomaliesFound = 0;

  // 1. Spike detection - abnormal increase in error rate
  const spikeResult = await detectErrorSpikes(userId);
  if (spikeResult.found) {
    anomaliesFound += spikeResult.count;
    details.push(...spikeResult.details);
  }

  // 2. Unusual source detection - new sources that appeared recently
  const sourceResult = await detectUnusualSources(userId);
  if (sourceResult.found) {
    anomaliesFound += sourceResult.count;
    details.push(...sourceResult.details);
  }

  // 3. Pattern anomaly - repeated identical errors
  const patternResult = await detectRepeatedPatterns(userId);
  if (patternResult.found) {
    anomaliesFound += patternResult.count;
    details.push(...patternResult.details);
  }

  return { anomaliesFound, details };
}

async function detectErrorSpikes(userId?: string): Promise<{ found: boolean; count: number; details: string[] }> {
  const details: string[] = [];
  let count = 0;

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

  const whereBase: Record<string, unknown> = {};
  if (userId) whereBase.userId = userId;

  // Current hour errors
  const currentErrors = await db.log.count({
    where: {
      ...whereBase,
      logLevel: { in: ['ERROR', 'CRITICAL', 'FATAL'] },
      timestamp: { gte: oneHourAgo },
    },
  });

  // Previous hour errors
  const previousErrors = await db.log.count({
    where: {
      ...whereBase,
      logLevel: { in: ['ERROR', 'CRITICAL', 'FATAL'] },
      timestamp: { gte: twoHoursAgo, lt: oneHourAgo },
    },
  });

  // If current errors are 3x the previous hour and more than 5
  if (currentErrors > previousErrors * 3 && currentErrors > 5) {
    await db.anomaly.create({
      data: {
        type: 'error_spike',
        severity: currentErrors > 50 ? 'critical' : currentErrors > 20 ? 'high' : 'medium',
        message: `Error spike detected: ${currentErrors} errors in the last hour (vs ${previousErrors} in previous hour)`,
        metadata: JSON.stringify({ currentErrors, previousErrors, ratio: previousErrors > 0 ? currentErrors / previousErrors : Infinity }),
        userId: userId || null,
      },
    });
    count++;
    details.push(`Error spike: ${currentErrors} current vs ${previousErrors} previous hour`);
  }

  return { found: count > 0, count, details };
}

async function detectUnusualSources(userId?: string): Promise<{ found: boolean; count: number; details: string[] }> {
  const details: string[] = [];
  let count = 0;

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Sources in last hour
  const recentSources = await db.log.findMany({
    where: {
      timestamp: { gte: oneHourAgo },
      source: { not: null },
    },
    select: { source: true },
    distinct: ['source'],
  });

  // Sources in last day before that
  const olderSources = await db.log.findMany({
    where: {
      timestamp: { gte: oneDayAgo, lt: oneHourAgo },
      source: { not: null },
    },
    select: { source: true },
    distinct: ['source'],
  });

  const olderSet = new Set(olderSources.map(s => s.source));
  const newSources = recentSources.filter(s => s.source && !olderSet.has(s.source));

  if (newSources.length > 0) {
    for (const source of newSources.slice(0, 5)) {
      if (!source.source) continue;
      await db.anomaly.create({
        data: {
          type: 'new_source',
          severity: 'low',
          message: `New log source detected: ${source.source}`,
          metadata: JSON.stringify({ source: source.source }),
          userId: userId || null,
        },
      });
      count++;
      details.push(`New source: ${source.source}`);
    }
  }

  return { found: count > 0, count, details };
}

async function detectRepeatedPatterns(userId?: string): Promise<{ found: boolean; count: number; details: string[] }> {
  const details: string[] = [];
  let count = 0;

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  // Find fingerprints with high occurrence count
  const fingerprintCounts = await db.log.groupBy({
    by: ['fingerprint'],
    where: {
      fingerprint: { not: null },
      timestamp: { gte: oneHourAgo },
      ...(userId ? { userId } : {}),
    },
    _count: { fingerprint: true },
    having: { fingerprint: { _count: { gt: 10 } } },
    orderBy: { _count: { fingerprint: 'desc' } },
    take: 5,
  });

  for (const fc of fingerprintCounts) {
    if (!fc.fingerprint) continue;
    await db.anomaly.create({
      data: {
        type: 'repeated_pattern',
        severity: fc._count.fingerprint > 100 ? 'high' : fc._count.fingerprint > 50 ? 'medium' : 'low',
        message: `Repeated error pattern: fingerprint ${fc.fingerprint} appeared ${fc._count.fingerprint} times in the last hour`,
        metadata: JSON.stringify({ fingerprint: fc.fingerprint, count: fc._count.fingerprint }),
        userId: userId || null,
      },
    });
    count++;
    details.push(`Repeated pattern: ${fc.fingerprint} (${fc._count.fingerprint} times)`);
  }

  return { found: count > 0, count, details };
}
