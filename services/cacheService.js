/**
 * P-09: Redis cache service for dashboard aggregation
 * FIX: Redis n'est plus mis à null sur erreur transiente — seule une reconnexion
 * épuisée désactive définitivement le cache.
 */

import logger from '../config/logger.js';

let redis = null;
let redisUnavailable = false; // FIX: flag séparé pour distinguer "pas encore connecté" vs "échec permanent"

async function initRedis() {
  try {
    const { createClient } = await import('redis');
    const url = process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`;
    redis = createClient({
      url,
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB || '0', 10),
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            logger.warn({ event: 'redis_reconnection_exhausted' }, '[CACHE]');
            redisUnavailable = true; // FIX: marquer comme indisponible sans null-ifier redis
            return false;
          }
          return Math.min(retries * 50, 500);
        }
      }
    });

    redis.on('error', (err) => {
      // FIX: Ne pas mettre redis = null ici — laisser la reconnection strategy gérer
      logger.warn({ event: 'redis_error', error: err.message }, '[CACHE]');
    });

    redis.on('reconnecting', () => {
      redisUnavailable = false; // tentative en cours
    });

    redis.on('connect', () => {
      redisUnavailable = false;
      logger.info({ event: 'redis_connected' }, '[CACHE]');
    });

    await redis.connect();
    return redis;
  } catch (e) {
    logger.warn({ event: 'redis_not_available', error: e.message }, '[CACHE]');
    redis = null;
    return null;
  }
}

function isReady() {
  return redis !== null && !redisUnavailable && redis.isReady;
}

const CACHE_TTL_STATS = 300; // 5 minutes for stats
const CACHE_TTL_COUNTERS = 60; // 1 minute for counters

export async function getCachedDashboard(userId) {
  if (!isReady()) return null;
  try {
    const key = `dashboard:${userId}`;
    const data = await redis.get(key);
    if (data) return JSON.parse(data);
  } catch (e) {
    logger.warn({ event: 'cache_get_error', error: e.message }, '[CACHE]');
  }
  return null;
}

export async function setCachedDashboard(userId, data) {
  if (!isReady()) return false;
  try {
    const key = `dashboard:${userId}`;
    // FIX #14: Use explicit TTL (300s for stats)
    await redis.setEx(key, CACHE_TTL_STATS, JSON.stringify(data));
    return true;
  } catch (e) {
    logger.warn({ event: 'cache_set_error', error: e.message }, '[CACHE]');
  }
  return false;
}

export async function invalidateDashboard(userId) {
  if (!isReady()) return false;
  try {
    const key = `dashboard:${userId}`;
    await redis.del(key);
    return true;
  } catch (e) {
    logger.warn({ event: 'cache_delete_error', error: e.message }, '[CACHE]');
  }
  return false;
}

export async function startCacheService() {
  redis = await initRedis();
  return redis !== null;
}

export function getRedisClient() {
  return isReady() ? redis : null;
}
export async function getCacheStatus() {
  try {
    const client = getRedisClient();
    if (!client) return { connected: false };
    await client.ping();
    return { connected: true };
  } catch (e) {
    return { connected: false };
  }
}