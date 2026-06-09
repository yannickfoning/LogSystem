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

// Afficher les utilisateurs disponibles
const [users] = await conn.query('SELECT id, email, role FROM users');
console.log('Utilisateurs disponibles:');
console.table(users);

// Afficher la distribution actuelle des logs
const [byUser] = await conn.query('SELECT user_id, COUNT(*) as count FROM logs GROUP BY user_id');
console.log('\nDistribution actuelle des logs par user_id:');
console.table(byUser);

// Mettre à jour les logs vers user_id 10 (analyste) - vous pouvez changer ce valeur
const targetUserId = 10;
const result = await conn.query('UPDATE logs SET user_id = ? WHERE user_id = 9', [targetUserId]);
console.log(`\n✅ ${result[0].affectedRows} logs mis à jour de user_id 9 vers user_id ${targetUserId}`);

// Vérifier après mise à jour
const [newDistribution] = await conn.query('SELECT user_id, COUNT(*) as count FROM logs GROUP BY user_id');
console.log('\Nouvelle distribution des logs par user_id:');
console.table(newDistribution);

await conn.end();
