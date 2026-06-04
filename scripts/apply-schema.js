import dotenv from 'dotenv';
dotenv.config();
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const conn = await mysql.createConnection({
  host:     process.env.DB_HOST,
  port:     21665,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl:      { rejectUnauthorized: false },
});

const sql = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');

const statements = sql
  .split(';')
  .map(s => s.trim())
  .filter(s => s.length > 0)
  .filter(s => !/^SET\s+(NAMES|FOREIGN)/i.test(s))
  .filter(s => !/^--/.test(s));

console.log('[SCHEMA] ' + statements.length + ' statements...');

for (const st of statements) {
  try {
    await conn.query(st);
  } catch (e) {
    console.warn('[skip] ' + e.code + ': ' + st.slice(0, 60));
  }
}

await conn.end();
console.log('[SCHEMA] Termine !');
