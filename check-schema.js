import mysql from 'mysql2/promise';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: {
    ca: fs.readFileSync('./ca.pem'),
    rejectUnauthorized: false
  }
});

const [a] = await conn.query('SHOW COLUMNS FROM alerts');
console.log('\n=== alerts ===');
console.table(a);

const [i] = await conn.query('SHOW COLUMNS FROM import_jobs');
console.log('\n=== import_jobs ===');
console.table(i);

const [l] = await conn.query('SHOW COLUMNS FROM logs');
console.log('\n=== toutes les colonnes logs ===');
console.table(l);

const [audit] = await conn.query('SHOW COLUMNS FROM audit_log');
console.log('\n=== audit_log ===');
console.table(audit);

const [sampleAlerts] = await conn.query('SELECT * FROM alerts LIMIT 5');
console.log('\n=== sample alerts data ===');
console.table(sampleAlerts);

const [sampleLogs] = await conn.query('SELECT id, timestamp, log_level, message, user_id FROM logs LIMIT 3');
console.log('\n=== sample logs data ===');
console.table(sampleLogs);

await conn.end();
