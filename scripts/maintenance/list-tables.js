import '../../config/loadEnv.js';
import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: 'information_schema'
});

const conn = await pool.getConnection();
const [tables] = await conn.query(`
  SELECT TABLE_NAME, TABLE_SCHEMA FROM TABLES WHERE TABLE_SCHEMA IN ('log', 'logsystem')
  ORDER BY TABLE_SCHEMA, TABLE_NAME
`);

console.log('Tables trouvées:');
tables.forEach(t => {
  console.log(`  - ${t.TABLE_SCHEMA}.${t.TABLE_NAME}`);
});

conn.release();
await pool.end();
