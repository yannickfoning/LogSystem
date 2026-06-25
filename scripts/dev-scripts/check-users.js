import dotenv from 'dotenv';
dotenv.config();
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

async function checkUsers() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  try {
    const [users] = await conn.execute('SELECT id, email, password_hash, display_name, role FROM users');
    console.log('Utilisateurs dans la base:');
    
    for (const user of users) {
      console.log(`- ${user.email} (role: ${user.role}, hash: ${user.password_hash ? 'OK' : 'NULL'})`);
      
      // Test du mot de passe admin
      if (user.email === 'admin@logsystem.local') {
        const isValid = await bcrypt.compare('Admin@1234', user.password_hash);
        console.log(`  Test mot de passe 'Admin@1234': ${isValid ? '✅' : '❌'}`);
      }
      
      // Test du mot de passe user
      if (user.email === 'user@logsystem.local') {
        const isValid = await bcrypt.compare('User@1234', user.password_hash);
        console.log(`  Test mot de passe 'User@1234': ${isValid ? '✅' : '❌'}`);
      }
    }
  } finally {
    await conn.end();
  }
}

checkUsers().catch(console.error);
