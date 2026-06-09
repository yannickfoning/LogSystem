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

console.log('🔄 Remise des logs sur user_id = 9 (admin)...');
const result = await conn.query('UPDATE logs SET user_id = 9 WHERE user_id = 10');
console.log(`✅ ${result[0].affectedRows} logs remis sur user_id 9 (admin)`);

// Vérifier la nouvelle distribution
const [newDistribution] = await conn.query('SELECT user_id, COUNT(*) as count FROM logs GROUP BY user_id');
console.log('\Nouvelle distribution des logs par user_id:');
console.table(newDistribution);

await conn.end();
