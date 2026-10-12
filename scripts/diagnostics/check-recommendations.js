import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'log'
});

const conn = await pool.getConnection();

const [tables] = await conn.query(
  'SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = "error_recommendations"'
);
console.log('Table error_recommendations exists:', tables[0].cnt > 0);

if (tables[0].cnt > 0) {
  const [recs] = await conn.query('SELECT * FROM error_recommendations');
  console.log('Recommendations in database:', recs.length);
  if (recs.length > 0) {
    console.log('Sample recommendations:');
    recs.slice(0, 3).forEach(r => {
      console.log(' -', r.error_type, ':', r.recommendation.substring(0, 50) + '...');
    });
  }
} else {
  console.log('Table error_recommendations does not exist');
}

conn.release();
await pool.end();