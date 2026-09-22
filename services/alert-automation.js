import pool from '../config/database.js';
import logger from '../config/logger.js';

/**
 * Configuration des temps de réponse par sévérité
 */
const SEVERITY_CONFIG = {
  FATAL: { interval: 1 * 60 * 1000, window: 'INTERVAL 1 HOUR', minCount: 3 },
  CRITICAL: { interval: 1 * 60 * 1000, window: 'INTERVAL 1 HOUR', minCount: 5 },
  ERROR: { interval: 5 * 60 * 1000, window: 'INTERVAL 4 HOUR', minCount: 10 },
  WARNING: { interval: 10 * 60 * 1000, window: 'INTERVAL 8 HOUR', minCount: 20 }
};

/**
 * Évaluer automatiquement les erreurs et créer des alertes
 * avec temps de réponse basés sur la sévérité
 */
export async function evaluateErrorsAndAlert() {
  try {
    // 1. Récupérer les erreurs ouvertes par sévérité
    const [openErrors] = await pool.execute(
      `SELECT 
        eg.id,
        eg.error_type,
        eg.occurrence_count,
        eg.user_id,
        eg.severity_max,
        l.log_level
       FROM error_groups eg
       LEFT JOIN logs l ON l.fingerprint = eg.fingerprint
       WHERE eg.status = 'open'
       AND eg.severity_max IN ('FATAL', 'CRITICAL', 'ERROR', 'WARNING')
       ORDER BY eg.severity_max DESC, eg.occurrence_count DESC`
    );

    for (const error of openErrors) {
      const config = SEVERITY_CONFIG[error.severity_max];
      if (!config) continue;

      // Vérifier le nombre minimum d'occurrences
      if (error.occurrence_count < config.minCount) continue;

      // 2. Vérifier si une alerte existe déjà dans la fenêtre de temps
      const [existingAlert] = await pool.execute(
        `SELECT id FROM alerts 
         WHERE metadata->'$.error_group_id' = ? 
         AND status != 'dismissed'
         AND created_at > DATE_SUB(NOW(), ${config.window})`,
        [error.id]
      );

      // 3. Créer une alerte SEULEMENT s'il n'en existe pas
      if (existingAlert.length === 0) {
        const alertSeverity = error.severity_max === 'FATAL' ? 'critical' : 
                            error.severity_max === 'CRITICAL' ? 'critical' :
                            error.severity_max === 'ERROR' ? 'high' : 'medium';

        await pool.execute(
          `INSERT INTO alerts 
           (rule_id, alert_type, severity, message, status, user_id, metadata, created_at)
           VALUES 
           (NULL, 'auto_error_critical', ?, ?, 'new', ?, ?, NOW())`,
          [
            alertSeverity,
            `⚠️ ${error.severity_max}: ${error.error_type} occurred ${error.occurrence_count} times`,
            error.user_id,
            JSON.stringify({ 
              error_group_id: error.id, 
              auto_generated: true,
              severity: error.severity_max 
            })
          ]
        );

        logger.info({ 
          event: 'auto_alert_created', 
          severity: error.severity_max,
          errorType: error.error_type,
          occurrences: error.occurrence_count,
          window: config.window
        });
      }
    }
  } catch (e) {
    logger.error({ event: 'alert_automation_error', error: e.message });
  }
}

// Démarrer l'automation dans server.js
export function startAlertAutomation(interval = 1 * 60 * 1000) {
  setInterval(evaluateErrorsAndAlert, interval);
  logger.info({ 
    event: 'alert_automation_started', 
    interval,
    severityConfig: Object.keys(SEVERITY_CONFIG)
  });
}