import { db } from './db';

export async function seedDefaultRules(): Promise<void> {
  const defaultRules = [
    {
      name: 'ERROR threshold',
      description: '10 erreurs en 5 minutes',
      conditionType: 'count',
      conditionValue: 'ERROR',
      thresholdValue: 10,
      timeWindowMinutes: 5,
      severity: 'high',
      cooldownMinutes: 5,
      isActive: true,
    },
    {
      name: 'FATAL immediate',
      description: '1 occurrence FATAL',
      conditionType: 'count',
      conditionValue: 'FATAL',
      thresholdValue: 1,
      timeWindowMinutes: 5,
      severity: 'critical',
      cooldownMinutes: 5,
      isActive: true,
    },
    {
      name: 'SECURITY threshold',
      description: '3 occurrences de securite en 5 minutes',
      conditionType: 'count',
      conditionValue: 'SECURITY',
      thresholdValue: 3,
      timeWindowMinutes: 5,
      severity: 'critical',
      cooldownMinutes: 10,
      isActive: true,
    },
    {
      name: 'AUTH failures',
      description: '5 echecs de connexion en 5 minutes',
      conditionType: 'count',
      conditionValue: 'AUTH',
      thresholdValue: 5,
      timeWindowMinutes: 5,
      severity: 'high',
      cooldownMinutes: 10,
      isActive: true,
    },
    {
      name: 'DISK usage',
      description: '80% espace disque utilise',
      conditionType: 'threshold',
      conditionValue: 'DISK',
      thresholdValue: 80,
      timeWindowMinutes: 5,
      severity: 'high',
      cooldownMinutes: 30,
      isActive: true,
    },
  ];

  for (const rule of defaultRules) {
    const existing = await db.alertRule.findFirst({ where: { name: rule.name } });
    if (existing) {
      await db.alertRule.update({ where: { id: existing.id }, data: rule });
    } else {
      await db.alertRule.create({ data: rule });
    }
  }

  console.log(`Seeded ${defaultRules.length} default alert rules`);
}
