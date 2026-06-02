import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';

// Ensure .env is loaded
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

// AMÉLIORATION Transverse: Optimized connection pool for 10k+ logs/sec
// Increased connectionLimit and tuned parameters for high throughput
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'log',
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '20', 10), // AMÉLIORATION: Increased from 10 to 20
  waitForConnections: true,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: '+00:00',      // FIX TIMEZONE-01: Forcer UTC pour coherence avec toISOString()
  namedPlaceholders: true,
  maxPreparedStatements: 100,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

// PERF-05: Connection pool monitoring with stats
let poolStats = {
  activeConnections: 0,
  queuedRequests: 0,
  totalAcquired: 0,
  totalReleased: 0
};

pool.on('acquire', (conn) => {
  poolStats.activeConnections++;
  poolStats.totalAcquired++;
  // Uncomment for debug: console.debug('[DB POOL] Connection acquired:', conn.threadId, 'Active:', poolStats.activeConnections);
});

pool.on('release', (conn) => {
  poolStats.activeConnections--;
  poolStats.totalReleased++;
});

export async function testConnection() {
  const conn = await pool.getConnection();
  try {
    await conn.ping();
    logger.info({ event: 'db_connection_success', poolStats }, '[DB] MySQL connection successful');
  } finally {
    conn.release();
  }
}

// Export pool stats for monitoring
export function getPoolStats() {
  return { ...poolStats };
}

// BUG-04 FIX: CRITICAL était mappé sur ERROR — préserver la distinction ENUM
export function normalizeLevel(raw) {
  if (!raw) return 'INFO';
  const s = raw.toString().toUpperCase().trim();
  if (['DEBUG', 'DBG', 'TRACE'].includes(s)) return 'DEBUG';
  if (s === 'WARN' || s === 'WARNING') return 'WARNING';
  if (s === 'CRITICAL') return 'CRITICAL'; // Distinct from ERROR
  if (['ERR', 'ERROR'].includes(s)) return 'ERROR';
  if (s === 'FATAL') return 'FATAL';
  return 'INFO';
}

// BUG-04 FIX: Mettre à jour severityOrder pour inclure CRITICAL entre ERROR et FATAL
const severityOrder = { DEBUG: 1, INFO: 2, WARNING: 3, ERROR: 4, CRITICAL: 5, FATAL: 6 };

export function levelSeverity(level) {
  return severityOrder[level] || 0;
}

export default pool;
