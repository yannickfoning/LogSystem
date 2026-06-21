import './loadEnv.js';
import mysql from 'mysql2/promise';
import logger from './logger.js';
import fs from 'fs';

export function normalizeLevel(level) {
  const l = String(level || 'INFO').toUpperCase();
  const valid = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL', 'FATAL', 'SECURITY'];
  return valid.includes(l) ? l : 'INFO';
}

export function levelSeverity(level) {
  const map = { 'DEBUG': 1, 'INFO': 2, 'WARNING': 3, 'ERROR': 4, 'CRITICAL': 5, 'FATAL': 6, 'SECURITY': 7 };
  return map[normalizeLevel(level)] || 0;
}

function normalizePem(value) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.includes('\\n') ? trimmed.replace(/\\n/g, '\n') : trimmed;
}

/** Lit le certificat CA : DB_SSL_CA → DB_SSL_CA_BASE64 → DB_SSL_CA_PATH */
export function readSslCa() {
  if (process.env.DB_SSL_CA) {
    return normalizePem(process.env.DB_SSL_CA);
  }

  if (process.env.DB_SSL_CA_BASE64) {
    try {
      const pem = Buffer.from(process.env.DB_SSL_CA_BASE64.trim(), 'base64').toString('utf8');
      return normalizePem(pem);
    } catch (err) {
      const msg = `[DB] Cannot decode DB_SSL_CA_BASE64: ${err.message}`;
      try { logger.warn({ event: 'ssl_ca_base64_error', error: err.message }, msg); }
      catch { console.warn(msg); }
      return undefined;
    }
  }

  const caPath = process.env.DB_SSL_CA_PATH;
  if (!caPath) return undefined;

  try {
    return fs.readFileSync(caPath, 'utf8');
  } catch (err) {
    const msg = `[DB] Cannot read SSL CA file (${caPath}): ${err.message}`;
    try { logger.warn({ event: 'ssl_ca_read_error', path: caPath, error: err.message }, msg); }
    catch { console.warn(msg); }
    return undefined;
  }
}

export function describeSslStatus() {
  if (process.env.DB_SSL !== 'true') return 'disabled';
  const ca = readSslCa();
  const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false';
  return `enabled (rejectUnauthorized=${rejectUnauthorized}, ca=${Boolean(ca)})`;
}

export function buildSslOptions() {
  if (process.env.DB_SSL !== 'true') return undefined;

  const ca = readSslCa();
  const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false';

  if (!ca && rejectUnauthorized) {
    const hint = process.env.VERCEL
      ? 'Set DB_SSL_CA, DB_SSL_CA_BASE64, or DB_SSL_REJECT_UNAUTHORIZED=false on Vercel'
      : 'Set DB_SSL_CA (inline PEM), DB_SSL_CA_BASE64, or DB_SSL_CA_PATH (file path)';
    try {
      logger.warn({ event: 'ssl_ca_missing', hint }, '[DB] SSL enabled without CA certificate');
    } catch {
      console.warn(`[DB] SSL enabled without CA certificate. ${hint}`);
    }
  }

  return { ca, rejectUnauthorized };
}

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'logsystem',
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10', 10),
  queueLimit: parseInt(process.env.DB_QUEUE_LIMIT || '0', 10),
  ssl: buildSslOptions(),
};

const pool = mysql.createPool(dbConfig);

try {
  logger.info(
    { event: 'db_pool_initialized', ssl: describeSslStatus() },
    '[DB] MySQL connection pool initialized successfully.'
  );
} catch {
  console.log('[DB] MySQL connection pool initialized successfully.', `ssl: "${describeSslStatus()}"`);
}

export default pool;

export async function testConnection() {
  const conn = await pool.getConnection();
  conn.release();
  return true;
}
