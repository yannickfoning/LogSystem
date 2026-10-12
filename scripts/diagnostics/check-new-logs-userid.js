import mysql from 'mysql2/promise';

const connection = await mysql.createConnection({
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: '',
  database: 'log'
});

console.log('=== Derniers logs insérés ===');
const [rows] = await connection.execute(
  'SELECT id, timestamp, log_level, message, user_id, source FROM logs ORDER BY id DESC LIMIT 5'
);

rows.forEach(row => {
  const message = row.message.length > 50 ? row.message.substring(0, 50) + '...' : row.message;
  console.log(`ID: ${row.id}, Level: ${row.log_level}, User_ID: ${row.user_id}, Message: ${message}`);
});

console.log('\n=== Vérification user_id pour les nouveaux logs ===');
const [newLogs] = await connection.execute(
  "SELECT id, timestamp, log_level, message, user_id FROM logs WHERE message LIKE '%nouveau%' OR message LIKE '%test%' ORDER BY id DESC LIMIT 3"
);

newLogs.forEach(row => {
  console.log(`ID: ${row.id}, Level: ${row.log_level}, User_ID: ${row.user_id}, Message: ${row.message}`);
});

await connection.end();
