import '../../config/loadEnv.js';

import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import { PROJECT_ROOT } from '../project-root.js';
import { buildSslOptions } from '../../config/database.js';

const schemaPath = path.join(PROJECT_ROOT, 'db', 'schema.sql');

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'logsystem',
  ssl: buildSslOptions(),
});

const sql = fs.readFileSync(schemaPath, 'utf8');

const statements = sql
  .split(';')
  .map(s => s.trim())
  .filter(s => s.length > 0)
  .filter(s => !/^SET\s+(NAMES|FOREIGN)/i.test(s))
  .filter(s => !/^--/.test(s));

console.log(`[SCHEMA] ${statements.length} statements from ${schemaPath}...`);

for (const st of statements) {
  try {
    await conn.query(st);
  } catch (e) {
    console.warn(`[skip] ${e.code}: ${st.slice(0, 60)}`);
  }
}

await conn.end();
console.log('[SCHEMA] Terminé. Préférez `node server.js` qui exécute le migration runner automatiquement.');
