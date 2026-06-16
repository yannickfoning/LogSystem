import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import logger from './logger.js';
import fs from 'fs'; // Required for reading CA certificate

dotenv.config();

export function normalizeLevel(level) {
  const l = String(level || 'INFO').toUpperCase();
  const valid = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL', 'FATAL', 'SECURITY'];
  return valid.includes(l) ? l : 'INFO';
}

export function levelSeverity(level) {
  const map = {
    'DEBUG': 1,
    'INFO': 2,
    'WARNING': 3,
    'ERROR': 4,
    'CRITICAL': 5,
    'FATAL': 6,
    'SECURITY': 7
  };
  return map[normalizeLevel(level)] || 0;
}

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root', // Consider a non-root user even for dev
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'logsystem',
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10', 10), // Crucial for performance
  queueLimit: parseInt(process.env.DB_QUEUE_LIMIT || '0', 10),
  ssl: process.env.DB_SSL === 'true' ? {
    ca: process.env.DB_SSL_CA_PATH ? fs.readFileSync(process.env.DB_SSL_CA_PATH) : undefined,
    rejectUnauthorized: process.env.NODE_ENV === 'production' // Enforce SSL certificate validation in production
  } : undefined
};

const pool = mysql.createPool(dbConfig);

pool.getConnection()
  .then(connection => {
    logger.info({ event: 'db_connected', env: process.env.NODE_ENV, database: `${dbConfig.user}@${dbConfig.host}/${dbConfig.database}` }, '[DB] MySQL connection pool initialized successfully.');
    connection.release(); // Release the connection used for testing
  })
  .catch(err => {
    logger.error({ event: 'db_connection_error', error: err.message }, '[DB] Failed to connect to MySQL database. Exiting.', err);
    process.exit(1); // Exit if DB connection fails
  });

export default pool;