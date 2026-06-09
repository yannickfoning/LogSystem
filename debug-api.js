import mysql from 'mysql2/promise';
import fs from 'fs';

const conn = await mysql.createConnection({
  host: 'mysql-aab9c07-yannickfoning22-33d3.d.aivencloud.com',
  port: 21661,
  user: 'avnadmin',
  password: 'AVNS_tflDPmE7FE7dnWKpjFY',
  database: 'defaultdb',
  ssl: { ca: fs.readFileSync('./ca.pem') }
});

// Vérifier les logs de l'admin
const [logs] = await conn.query(
  'SELECT id, user_id, log_level, timestamp, source, message FROM logs WHERE user_id = 9 LIMIT 3'
);
console.log('Logs user_id=9:');
console.table(logs);

// Vérifier si timestamp est valide
const [invalid] = await conn.query(
  "SELECT COUNT(*) as count FROM logs WHERE timestamp IS NULL"
);
console.log('Logs avec timestamp null:', invalid[0].count);

// Vérifier la session admin
const [sessions] = await conn.query('SELECT * FROM sessions LIMIT 3');
console.log('Sessions actives:', sessions.length);
console.table(sessions);

await conn.end();
