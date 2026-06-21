import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import logger from './logger.js';
import fs from 'fs';

dotenv.config();

export function normalizeLevel(level) {
  const l = String(level || 'INFO').toUpperCase();
  const valid = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL', 'FATAL', 'SECURITY'];
  return valid.includes(l) ? l : 'INFO';
}

export function levelSeverity(level) {
  const map = { 'DEBUG': 1, 'INFO': 2, 'WARNING': 3, 'ERROR': 4, 'CRITICAL': 5, 'FATAL': 6, 'SECURITY': 7 };
  return map[normalizeLevel(level)] || 0;
}

// Lecture sécurisée du CA Aiven — ne crashe pas si le fichier est absent
function readCaFile() {
  // Support CA inline (base64) via env var — utile sur Vercel où on ne peut pas
  // uploader de fichier. Mettre le contenu du ca.pem en base64 dans DB_SSL_CA_BASE64.
  const caBase64 = process.env.DB_SSL_CA_BASE64;
  if (caBase64) {
    try {
      return Buffer.from(caBase64, 'base64');
    } catch (err) {
      console.warn('[DB] Failed to decode DB_SSL_CA_BASE64:', err.message);
    }
  }

  const caPath = process.env.DB_SSL_CA_PATH;
  if (!caPath) return undefined;
  try {
    return fs.readFileSync(caPath);
  } catch (err) {
    const msg = `[DB] Cannot read SSL CA file (${caPath}): ${err.message}`;
    try { logger.warn({ event: 'ssl_ca_read_error', path: caPath, error: err.message }, msg); }
    catch { console.warn(msg); }
    return undefined;
  }
}

function buildSslConfig() {
  const sslEnabled = process.env.DB_SSL === 'true';
  if (!sslEnabled) return undefined;

  const ca = readCaFile();

  // Sur Aiven : le certificat est auto-signé par Aiven CA.
  // Si DB_SSL_CA_BASE64 ou DB_SSL_CA_PATH est fourni → on valide avec ce CA (sécurisé).
  // Sinon → rejectUnauthorized=false (nécessaire sur Vercel sans accès fichier).
  // DB_SSL_REJECT_UNAUTHORIZED peut forcer le comportement dans les deux sens.
  let rejectUnauthorized;
  if (process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true') {
    rejectUnauthorized = true;
  } else if (process.env.DB_SSL_REJECT_UNAUTHORIZED === 'false') {
    rejectUnauthorized = false;
  } else {
    // Par défaut : false si pas de CA fourni (Aiven sans fichier CA = Vercel)
    //             true si CA fourni (plus sécurisé)
    rejectUnauthorized = !!ca;
  }

  return { ca, rejectUnauthorized };
}

const sslConfig = buildSslConfig();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'logsystem',
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10', 10),
  queueLimit: parseInt(process.env.DB_QUEUE_LIMIT || '0', 10),
  ssl: sslConfig,
};

const pool = mysql.createPool(dbConfig);

// Test connexion au démarrage — sans process.exit (incompatible Vercel serverless)
pool.getConnection()
  .then(connection => {
    logger.info({
      event: 'db_connected',
      env: process.env.NODE_ENV,
      database: `${dbConfig.user}@${dbConfig.host}/${dbConfig.database}`,
      ssl: sslConfig ? `enabled (rejectUnauthorized=${sslConfig.rejectUnauthorized}, ca=${!!sslConfig.ca})` : 'disabled'
    }, '[DB] MySQL connection pool initialized successfully.');
    connection.release();
  })
  .catch(err => {
    // Ne pas appeler process.exit() — sur Vercel cela tuerait la lambda pour toutes les requêtes
    // L'erreur sera visible dans les logs et chaque requête DB retournera une erreur 500
    logger.error({ event: 'db_connection_error', error: err.message, code: err.code }, '[DB] Failed to connect to MySQL. Check DB_HOST, DB_USER, DB_PASSWORD, DB_SSL env vars.');
  });

export default pool;

export async function testConnection() {
  const conn = await pool.getConnection();
  conn.release();
  return true;
}

export function buildSslOptions() {
  return sslConfig;
}