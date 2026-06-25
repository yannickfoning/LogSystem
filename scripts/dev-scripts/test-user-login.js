import dotenv from 'dotenv';
dotenv.config();
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

async function testUserLogin() {
  try {
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME
    });

    console.log('=== Test du compte utilisateur ===');
    
    // Vérifier l'utilisateur
    const [users] = await conn.execute('SELECT id, email, password_hash, display_name, role, is_active FROM users WHERE email = ?', ['user@logsystem.local']);
    
    if (users.length === 0) {
      console.log('❌ Utilisateur non trouvé dans la base');
      return;
    }
    
    const user = users[0];
    console.log('✅ Utilisateur trouvé:');
    console.log(`  Email: ${user.email}`);
    console.log(`  Role: ${user.role}`);
    console.log(`  Actif: ${user.is_active ? 'OUI' : 'NON'}`);
    console.log(`  Hash présent: ${user.password_hash ? 'OUI' : 'NON'}`);
    
    // Tester le mot de passe
    const passwordTest = await bcrypt.compare('User@1234', user.password_hash);
    console.log(`  Test mot de passe 'User@1234': ${passwordTest ? '✅' : '❌'}`);
    
    // Vérifier s'il y a des logs de connexion précédents
    const [auditLogs] = await conn.execute('SELECT * FROM audit_log WHERE user_email = ? ORDER BY created_at DESC LIMIT 5', ['user@logsystem.local']);
    console.log(`  Logs d'audit récents: ${auditLogs.length}`);
    
    if (auditLogs.length > 0) {
      console.log('  Dernières tentatives:');
      auditLogs.forEach(log => {
        console.log(`    - ${log.created_at}: ${log.action} (${log.ip_address})`);
      });
    }
    
    await conn.end();
  } catch (err) {
    console.error('❌ Erreur:', err.message);
  }
}

testUserLogin();
