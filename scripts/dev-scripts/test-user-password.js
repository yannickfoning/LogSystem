import dotenv from 'dotenv';
dotenv.config();
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

async function testUserPassword() {
  try {
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME
    });

    const [users] = await conn.execute('SELECT password_hash FROM users WHERE email = ?', ['user@logsystem.local']);
    
    if (users.length > 0) {
      const isValid = await bcrypt.compare('User@1234', users[0].password_hash);
      console.log('Test mot de passe User@1234:', isValid ? '✅ VALIDE' : '❌ INVALIDE');
      
      // Si invalide, testons avec le mot de passe admin
      if (!isValid) {
        const adminValid = await bcrypt.compare('Admin@1234', users[0].password_hash);
        console.log('Test avec Admin@1234:', adminValid ? '✅ VALIDE (mauvais mot de passe)' : '❌ INVALIDE');
      }
    } else {
      console.log('❌ Utilisateur non trouvé');
    }
    
    await conn.end();
  } catch (err) {
    console.error('❌ Erreur:', err.message);
  }
}

testUserPassword();
