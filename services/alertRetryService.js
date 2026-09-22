import pool from '../config/database.js';
import logger from '../config/logger.js';

/**
 * Configuration de retry
 */
const RETRY_CONFIG = {
  maxAttempts: 3,
  baseDelay: 1 * 60 * 1000, // 1 minute
  maxDelay: 30 * 60 * 1000, // 30 minutes
  backoffMultiplier: 2
};

/**
 * Calculer le délai de retry avec backoff exponentiel
 */
function calculateRetryDelay(attempt) {
  const delay = RETRY_CONFIG.baseDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt);
  return Math.min(delay, RETRY_CONFIG.maxDelay);
}

/**
 * Enregistrer une tentative de retry échouée
 */
export async function recordAlertRetry(alertId, error) {
  try {
    const [alert] = await pool.execute(
      `SELECT retry_count FROM alerts WHERE id = ?`,
      [alertId]
    );

    if (alert.length === 0) {
      logger.warn({ event: 'alert_retry_not_found', alertId });
      return false;
    }

    const currentRetryCount = alert[0].retry_count || 0;
    
    if (currentRetryCount >= RETRY_CONFIG.maxAttempts) {
      logger.warn({ 
        event: 'alert_retry_max_attempts', 
        alertId, 
        attempts: currentRetryCount 
      });
      return false;
    }

    const nextDelay = calculateRetryDelay(currentRetryCount);
    const nextAttempt = new Date(Date.now() + nextDelay);

    await pool.execute(
      `UPDATE alerts 
       SET retry_count = retry_count + 1,
           retry_last_attempt = NOW(),
           retry_next_attempt = ?,
           retry_error = ?
       WHERE id = ?`,
      [nextAttempt, error?.message || 'Unknown error', alertId]
    );

    logger.info({ 
      event: 'alert_retry_scheduled', 
      alertId, 
      attempt: currentRetryCount + 1,
      nextAttempt,
      delay: nextDelay
    });

    return true;
  } catch (e) {
    logger.error({ event: 'alert_retry_record_failed', error: e.message });
    return false;
  }
}

/**
 * Réinitialiser les compteurs de retry après succès
 */
export async function resetAlertRetry(alertId) {
  try {
    await pool.execute(
      `UPDATE alerts 
       SET retry_count = 0,
           retry_last_attempt = NULL,
           retry_next_attempt = NULL,
           retry_error = NULL
       WHERE id = ?`,
      [alertId]
    );

    logger.info({ event: 'alert_retry_reset', alertId });
    return true;
  } catch (e) {
    logger.error({ event: 'alert_retry_reset_failed', error: e.message });
    return false;
  }
}

/**
 * Récupérer les alertes prêtes pour retry
 */
export async function getAlertsReadyForRetry() {
  try {
    const [alerts] = await pool.execute(
      `SELECT id, retry_count, retry_error, metadata
       FROM alerts 
       WHERE retry_next_attempt IS NOT NULL
       AND retry_next_attempt <= NOW()
       AND retry_count < ?
       AND status != 'dismissed'
       ORDER BY retry_next_attempt ASC`,
      [RETRY_CONFIG.maxAttempts]
    );

    return alerts;
  } catch (e) {
    logger.error({ event: 'alert_retry_fetch_failed', error: e.message });
    return [];
  }
}

/**
 * Traitement des retents planifiés
 */
export async function processRetryQueue() {
  try {
    const alertsToRetry = await getAlertsReadyForRetry();
    
    logger.info({ 
      event: 'alert_retry_queue_processed', 
      count: alertsToRetry.length 
    });

    for (const alert of alertsToRetry) {
      // Ici, vous pourriez réexécuter la logique de livraison de l'alerte
      // Par exemple, SSE, email, webhook, etc.
      logger.info({ 
        event: 'alert_retry_attempt', 
        alertId: alert.id,
        attempt: alert.retry_count 
      });

      // Si la tentative réussit, réinitialiser
      // await resetAlertRetry(alert.id);
    }
  } catch (e) {
    logger.error({ event: 'alert_retry_process_failed', error: e.message });
  }
}

/**
 * Démarrer le scheduler de retry
 */
export function startRetryScheduler(interval = 1 * 60 * 1000) {
  setInterval(processRetryQueue, interval);
  logger.info({ 
    event: 'alert_retry_scheduler_started', 
    interval,
    maxAttempts: RETRY_CONFIG.maxAttempts
  });
}
