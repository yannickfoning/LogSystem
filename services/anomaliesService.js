/**
 * Phase 8 : Détection Automatique d'Anomalies par Z-Score (et baseline statistique)
 */

import pool from '../config/database.js';
import logger from '../config/logger.js';

/**
 * Détecte un pic anormal de volume (COUNT) sur une fenêtre glissante.
 * - Fenêtre courante: 5 minutes
 * - Baseline: blocs de 5 minutes sur 24 heures
 */
export async function detectVolumeAnomalies(userId) {
  try {
    // 1) Récupérer le volume de logs des 5 dernières minutes
    const [currentRows] = await pool.execute(
      `SELECT COUNT(*) as count
       FROM logs
       WHERE user_id = ?
         AND timestamp >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)`,
      [userId]
    );
    const currentCount = currentRows[0].count;

    // 2) Récupérer l'historique des fenêtres de 5 minutes sur les dernières 24 heures
    const [historyRows] = await pool.execute(
      `SELECT COUNT(*) as count
       FROM logs
       WHERE user_id = ?
         AND timestamp >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
       GROUP BY FLOOR(UNIX_TIMESTAMP(timestamp) / 300)` ,
      [userId]
    );

    if (!historyRows || historyRows.length < 5) return;

    const counts = historyRows.map(r => Number(r.count || 0));
    const totalBlocks = counts.length;
    const avg = counts.reduce((a, b) => a + b, 0) / totalBlocks;

    // Standard deviation
    const variance = counts.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / totalBlocks;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return;

    // Z-Score
    const zScore = (currentCount - avg) / stdDev;

    // Seuil classique d'anomalie statistique
    if (zScore > 2.5) {
      const message = `Pic anormal: ${currentCount} logs/5min (avg=${avg.toFixed(1)}, z=${zScore.toFixed(2)})`;

      logger.warn({ event: 'anomaly_detected', userId, zScore, currentCount, avg }, message);

      await pool.execute(
        `INSERT INTO anomalies (type, severity, message, user_id, metadata)
         VALUES (?, ?, ?, ?, ?)`,
        [
          'TRAFFIC_SPIKE',
          'WARNING',
          message,
          userId,
          JSON.stringify({ currentCount, average: avg, zScore })
        ]
      );
    }
  } catch (error) {
    logger.error({ event: 'anomaly_detection_failed', userId, error: error.message });
  }
}

