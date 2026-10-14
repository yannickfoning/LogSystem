import mysql from 'mysql2/promise';

const connection = await mysql.createConnection({
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: '',
  database: 'log'
});

console.log('=== Logs avec user_id = NULL avant update ===');
const [beforeRows] = await connection.execute(
  'SELECT COUNT(*) as count FROM logs WHERE user_id IS NULL'
);
console.log('Logs avec user_id = NULL:', beforeRows[0].count);

console.log('=== UPDATE logs SET user_id = 1 WHERE user_id IS NULL ===');
const [result] = await connection.execute(
  'UPDATE logs SET user_id = 1 WHERE user_id IS NULL'
);
console.log('Logs mis à jour:', result.affectedRows);

console.log('=== Vérification après update ===');
const [afterRows] = await connection.execute(
  'SELECT COUNT(*) as count FROM logs WHERE user_id IS NULL'
);
console.log('Logs avec user_id = NULL après update:', afterRows[0].count);

console.log('=== Distribution user_id ===');
const [distribution] = await connection.execute(
  'SELECT user_id, COUNT(*) as count FROM logs GROUP BY user_id'
);
distribution.forEach(row => {
  console.log('User_ID:', row.user_id, ', Count:', row.count);
});

await connection.end();
