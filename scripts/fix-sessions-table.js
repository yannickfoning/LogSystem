import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function fixSessionsTable() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'logsystem'
  });

  const conn = await pool.getConnection();

  try {
    console.log('Fixing sessions table...');
    
    // Drop the table if it exists
    try {
      await conn.query('DROP TABLE IF EXISTS sessions');
      console.log('Sessions table dropped');
    } catch (e) {
      console.log('Drop failed (table may not exist):', e.message);
    }

    // Create the sessions table (using the structure from the log database)
    await conn.query(`
      CREATE TABLE sessions (
        session_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
        expires INT(11) UNSIGNED NOT NULL,
        data MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
        PRIMARY KEY (session_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);
    
    console.log('✅ Sessions table created successfully');
  } catch (e) {
    console.error('❌ Error:', e.message);
    throw e;
  } finally {
    conn.release();
    await pool.end();
  }
}

fixSessionsTable().catch(console.error);