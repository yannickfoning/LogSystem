import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function checkUsers() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'log'
  });

  const conn = await pool.getConnection();
  const [users] = await conn.query('SELECT id, email, display_name, role, is_active FROM users');
  
  console.log('Users in database:');
  if (users.length === 0) {
    console.log('No users found. You need to create default users.');
  } else {
    users.forEach(u => {
      console.log(` - ID: ${u.id}, Email: ${u.email}, Name: ${u.display_name}, Role: ${u.role}, Active: ${u.is_active}`);
    });
  }
  
  conn.release();
  await pool.end();
}

checkUsers().catch(console.error);