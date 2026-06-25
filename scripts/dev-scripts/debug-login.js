import dotenv from 'dotenv';
dotenv.config();
import mysql from 'mysql2/promise';

async function debugLogin() {
  try {
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME
    });
    console.log('✅ Connexion DB OK');
    
    const [users] = await conn.execute('SELECT email, password_hash FROM users WHERE role = ?', ['admin']);
    console.log('👤 Admin users:', users.length);
    
    if (users.length > 0) {
      console.log('📧 Email admin:', users[0].email);
      console.log('🔑 Hash présent:', users[0].password_hash ? 'OUI' : 'NON');
    }
    
    await conn.end();
  } catch (err) {
    console.error('❌ Erreur DB:', err.message);
  }
}

debugLogin();
