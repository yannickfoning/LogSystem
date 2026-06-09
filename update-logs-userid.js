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

// Vérifier combien de logs ont user_id = 9 avant la mise à jour
const [before] = await conn.query('SELECT COUNT(*) as count FROM logs WHERE user_id = 9');
console.log('Logs avec user_id = 9 avant mise à jour:', before[0].count);

// Mettre à jour les logs pour les assigner à l'admin (ID 11)
const [result] = await conn.query('UPDATE logs SET user_id = 11 WHERE user_id = 9');
console.log('Logs mis à jour:', result.affectedRows);

// Vérifier combien de logs ont user_id = 11 après la mise à jour
const [after] = await conn.query('SELECT COUNT(*) as count FROM logs WHERE user_id = 11');
console.log('Logs avec user_id = 11 après mise à jour:', after[0].count);

await conn.end();
