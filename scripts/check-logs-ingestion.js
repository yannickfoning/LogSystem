import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function checkLogsIngestion() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'log'
  });

  const conn = await pool.getConnection();
  const [logs] = await conn.query('SELECT COUNT(*) as cnt FROM logs');
  console.log('Logs count:', logs[0].cnt);
  
  const [recentLogs] = await conn.query('SELECT id, timestamp, log_level, message FROM logs ORDER BY id DESC LIMIT 5');
  console.log('Recent logs:');
  recentLogs.forEach(l => {
    console.log(` - ID: ${l.id}, ${l.timestamp}, ${l.log_level}, ${l.message}`);
  });
  
  conn.release();
  await pool.end();
}

checkLogsIngestion().catch(console.error);