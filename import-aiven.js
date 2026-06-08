import mysql from 'mysql2/promise';
import fs from 'fs';

const conn = await mysql.createConnection({
  host: 'mysql-aab9c07-yannickfoning22-33d3.d.aivencloud.com',
  port: 21661,
  user: 'avnadmin',
  password: 'AVNS_tflDPmE7FE7dnWKpjFY',
  database: 'defaultdb',
  ssl: { ca: fs.readFileSync('./ca.pem') },
  multipleStatements: true
});

console.log('📦 Import en cours...');
await conn.query('SET SESSION sql_require_primary_key = 0');
await conn.query('SET FOREIGN_KEY_CHECKS = 0');
const sql = fs.readFileSync('./db/log.sql', 'utf8');
await conn.query(sql);
await conn.query('SET FOREIGN_KEY_CHECKS = 1');
console.log('✅ Import terminé !');
await conn.end();
