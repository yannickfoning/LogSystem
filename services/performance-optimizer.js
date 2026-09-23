import pool from '../config/database.js';
import logger from '../config/logger.js';

const QUERY_CACHE_TTL = 30000; // 30 secondes
const queryCache = new Map();

/**
 * Cache wrapper pour les requêtes fréquentes
 */
export async function cachedQuery(key, queryFn, ttl = QUERY_CACHE_TTL) {
  const cached = queryCache.get(key);
  if (cached && Date.now() - cached.timestamp < ttl) {
    return cached.data;
  }

  const data = await queryFn();
  queryCache.set(key, { data, timestamp: Date.now() });
  return data;
}

/**
 * Nettoyer le cache périodiquement
 */
export function initCacheCleanup(interval = 60000) {
  setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, value] of queryCache.entries()) {
      if (now - value.timestamp > QUERY_CACHE_TTL * 2) {
        queryCache.delete(key);
        cleaned++;
      }
    }
    logger.info({ event: 'cache_cleanup', remaining: queryCache.size, cleaned }, '[CACHE]');
  }, interval);
}

/**
 * Pré-calcul des statistiques d'erreurs
 */
export async function precomputeErrorStats(userId) {
  try {
    const cacheKey = `error_stats:${userId}`;
    return await cachedQuery(cacheKey, async () => {
      const [stats] = await pool.execute(
        `SELECT 
          error_type,
          COUNT(*) as count,
          MAX(timestamp) as last_seen
         FROM logs
         WHERE user_id = ? AND timestamp >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
         GROUP BY error_type
         ORDER BY count DESC
         LIMIT 50`,
        [userId]
      );
      return stats;
    });
  } catch (e) {
    logger.error({ event: 'precompute_stats_error', error: e.message });
    return [];
  }
}

/**
 * Batch update pour recommendation_frequency
 */
export async function updateRecommendationFrequency(userId) {
  try {
    // Récupérer les erreurs du dernier jour
    const [errors] = await pool.execute(
      `SELECT error_type, log_level, COUNT(*) as cnt, MAX(timestamp) as last_ts
       FROM logs
       WHERE user_id = ? AND timestamp >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
       AND error_type IS NOT NULL
       GROUP BY error_type, log_level`,
      [userId]
    );

    // Update batch (plus rapide que des inserts individuels)
    for (const error of errors) {
      await pool.execute(
        `INSERT INTO recommendation_frequency (error_type, log_level, occurrence_count, last_triggered, user_id)
         VALUES (?, ?, ?, NOW(), ?)
         ON DUPLICATE KEY UPDATE
         occurrence_count = occurrence_count + VALUES(occurrence_count),
         last_triggered = NOW()`,
        [error.error_type, error.log_level, error.cnt, userId]
      );
    }

    logger.info({ event: 'freq_updated', count: errors.length, userId }, '[FREQ]');
  } catch (e) {
    logger.error({ event: 'update_frequency_error', error: e.message });
  }
}

/**
 * Invalider le cache pour un utilisateur spécifique
 */
export function invalidateUserCache(userId) {
  const keysToDelete = [];
  for (const key of queryCache.keys()) {
    if (key.includes(`:${userId}`) || key.startsWith(`${userId}:`)) {
      keysToDelete.push(key);
    }
  }
  keysToDelete.forEach(key => queryCache.delete(key));
  logger.info({ event: 'cache_invalidated', userId, keysDeleted: keysToDelete.length }, '[CACHE]');
}

/**
 * Obtenir les statistiques du cache
 */
export function getCacheStats() {
  return {
    size: queryCache.size,
    ttl: QUERY_CACHE_TTL,
    keys: Array.from(queryCache.keys())
  };
}