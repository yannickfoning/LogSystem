#!/usr/bin/env node
/**
 * Seed default alert rules and recommendations
 * Usage: node scripts/setup/seed-default-alerts.js
 */

import pool from '../../config/database.js';
import logger from '../../config/logger.js';

async function seedDefaultAlerts() {
  try {
    logger.info({ event: 'seeding_alerts' }, '[SEED] Starting default alerts seeding...');

    const defaultAlerts = [
      {
        name: 'Erreurs critiques détectées',
        description: 'Alerte quand des logs CRITICAL ou FATAL sont détectés',
        condition_type: 'level',
        condition_value: 'CRITICAL,FATAL',
        threshold_value: 1,
        time_window_minutes: 5,
        severity: 'high',
        cooldown_minutes: 30,
        is_global: 1
      },
      {
        name: 'Pic d\'erreurs',
        description: 'Alerte si plus de 10 erreurs en 10 minutes',
        condition_type: 'error_rate',
        condition_value: 'ERROR',
        threshold_value: 10,
        time_window_minutes: 10,
        severity: 'medium',
        cooldown_minutes: 30,
        is_global: 1
      },
      {
        name: 'Volume anormal de logs',
        description: 'Alerte si volume détecté anormal (20x au-dessus de la moyenne)',
        condition_type: 'anomaly',
        condition_value: 'volume',
        threshold_value: 20,
        time_window_minutes: 60,
        severity: 'medium',
        cooldown_minutes: 60,
        is_global: 1
      },
      {
        name: 'Inactivité des logs',
        description: 'Alerte si aucun log reçu depuis 2 heures',
        condition_type: 'log_inactivity',
        condition_value: '2h',
        threshold_value: 120,
        time_window_minutes: 120,
        severity: 'low',
        cooldown_minutes: 120,
        is_global: 1
      },
      {
        name: 'Erreurs multiples du même type',
        description: 'Alerte si 5+ erreurs du même type en 15 minutes',
        condition_type: 'error_pattern',
        condition_value: 'repeated',
        threshold_value: 5,
        time_window_minutes: 15,
        severity: 'high',
        cooldown_minutes: 45,
        is_global: 1
      },
      {
        name: 'Erreur de base de données',
        description: 'Alerte sur erreurs contenant "database" ou "connection"',
        condition_type: 'keyword',
        condition_value: 'database,connection,timeout',
        threshold_value: 3,
        time_window_minutes: 10,
        severity: 'high',
        cooldown_minutes: 30,
        is_global: 1
      }
    ];

    let seeded = 0;

    for (const alert of defaultAlerts) {
      try {
        const [result] = await pool.execute(
          `INSERT IGNORE INTO alert_rules 
          (name, description, condition_type, condition_value, threshold_value, time_window_minutes, severity, cooldown_minutes, is_active, is_global, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 1)`,
          [
            alert.name,
            alert.description,
            alert.condition_type,
            alert.condition_value,
            alert.threshold_value,
            alert.time_window_minutes,
            alert.severity,
            alert.cooldown_minutes,
            alert.is_global
          ]
        );

        if (result.affectedRows > 0) {
          seeded++;
          logger.info({ event: 'alert_seeded', name: alert.name }, '[SEED]');
        }
      } catch (e) {
        logger.warn({ event: 'alert_seed_failed', name: alert.name, error: e.message }, '[SEED]');
      }
    }

    logger.info({ event: 'alerts_seeded', count: seeded }, `[SEED] ${seeded} alertes créées`);
    return seeded;
  } catch (e) {
    logger.error({ event: 'seed_alerts_error', error: e.message }, '[SEED]');
    throw e;
  }
}

async function seedDefaultRecommendations() {
  try {
    logger.info({ event: 'seeding_recommendations' }, '[SEED] Starting recommendations seeding...');

    const defaultRecs = [
      {
        title: 'Configurer les alertes critiques',
        description: 'Mettez en place des alertes pour les erreurs CRITICAL et FATAL',
        category: 'alerts',
        priority: 'high',
        action_url: '/admin.html#alerts'
      },
      {
        title: 'Importer les premiers logs',
        description: 'Importez vos premiers logs via RAR, ZIP ou 7Z pour commencer le monitoring',
        category: 'import',
        priority: 'high',
        action_url: '/import.html'
      },
      {
        title: 'Configurer la rétention',
        description: 'Définissez la période de rétention des logs pour optimiser l\'espace disque',
        category: 'maintenance',
        priority: 'medium',
        action_url: '/admin.html#retention'
      },
      {
        title: 'Activer le monitoring temps réel',
        description: 'Utilisez WatchLog pour surveiller les logs et imports en temps réel',
        category: 'monitoring',
        priority: 'medium',
        action_url: '/watchlog.html'
      },
      {
        title: 'Configurer les services',
        description: 'Ajoutez les services à monitorer dans les paramètres utilisateur',
        category: 'configuration',
        priority: 'medium',
        action_url: '/dashboard.html'
      },
      {
        title: 'Consulter les tendances',
        description: 'Analysez les tendances d\'erreurs pour identifier les patterns',
        category: 'analysis',
        priority: 'low',
        action_url: '/dashboard.html#trends'
      }
    ];

    let seeded = 0;

    for (const rec of defaultRecs) {
      try {
        const [result] = await pool.execute(
          `INSERT IGNORE INTO recommendations 
          (title, description, category, priority, action_url, is_active, is_global)
          VALUES (?, ?, ?, ?, ?, 1, 1)`,
          [
            rec.title,
            rec.description,
            rec.category,
            rec.priority,
            rec.action_url
          ]
        );

        if (result.affectedRows > 0) {
          seeded++;
          logger.info({ event: 'recommendation_seeded', title: rec.title }, '[SEED]');
        }
      } catch (e) {
        logger.warn({ event: 'rec_seed_failed', title: rec.title, error: e.message }, '[SEED]');
      }
    }

    logger.info({ event: 'recommendations_seeded', count: seeded }, `[SEED] ${seeded} recommandations créées`);
    return seeded;
  } catch (e) {
    logger.error({ event: 'seed_recommendations_error', error: e.message }, '[SEED]');
    throw e;
  }
}

async function main() {
  try {
    await seedDefaultAlerts();
    await seedDefaultRecommendations();
    logger.info({ event: 'seed_complete' }, '[SEED] Seeding completed successfully');
    process.exit(0);
  } catch (e) {
    logger.error({ event: 'seed_failed', error: e.message }, '[SEED]');
    process.exit(1);
  }
}

export { seedDefaultAlerts, seedDefaultRecommendations };

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
