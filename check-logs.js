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

const [users] = await conn.query('SELECT id, email, role FROM users');
const [total] = await conn.query('SELECT COUNT(*) as total FROM logs');
const [byUser] = await conn.query('SELECT user_id, COUNT(*) as count FROM logs GROUP BY user_id');
const [sample] = await conn.query('SELECT id, user_id, log_level, timestamp, source FROM logs LIMIT 5');

console.log('Utilisateurs:');
console.table(users);
console.log('Total logs:', total[0].total);
console.log('\nPar user_id:');
console.table(byUser);
console.log('\nÉchantillon:');
console.table(sample);

await conn.end();
