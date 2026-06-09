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

const [users] = await conn.query('SELECT id, email FROM users WHERE email = ?', ['admin@logsystem.com']);
console.table(users);

if (users.length > 0) {
  console.log(`\n✅ ID de admin@logsystem.com : ${users[0].id}`);
} else {
  console.log('\n❌ Utilisateur admin@logsystem.com non trouvé');
}

await conn.end();
