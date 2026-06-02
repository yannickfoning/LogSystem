import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: 'log'
});

async function createDefaultUsers() {
  const conn = await pool.getConnection();
  
  try {
    console.log('🔐 Création des utilisateurs par défaut...\n');
    
    // Créer l'utilisateur admin
    const adminPassword = 'admin123';
    const adminHash = await bcrypt.hash(adminPassword, 10);
    
    console.log('➕ Création de l\'utilisateur admin...');
    const [adminResult] = await conn.query(
      'INSERT INTO users (email, password_hash, display_name, role, is_active, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
      ['admin@logsystem.local', adminHash, 'Administrateur', 'admin', 1]
    );
    console.log(`   ✅ Admin créé (ID: ${adminResult.insertId})`);
    console.log(`   Email: admin@logsystem.local`);
    console.log(`   Mot de passe: ${adminPassword}\n`);
    
    // Créer l'utilisateur user
    const userPassword = 'user123';
    const userHash = await bcrypt.hash(userPassword, 10);
    
    console.log('➕ Création de l\'utilisateur user...');
    const [userResult] = await conn.query(
      'INSERT INTO users (email, password_hash, display_name, role, is_active, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
      ['user@logsystem.local', userHash, 'Utilisateur Standard', 'user', 1]
    );
    console.log(`   ✅ User créé (ID: ${userResult.insertId})`);
    console.log(`   Email: user@logsystem.local`);
    console.log(`   Mot de passe: ${userPassword}\n`);
    
    // Afficher les utilisateurs créés
    const [users] = await conn.query('SELECT id, email, display_name, role, is_active FROM users ORDER BY id');
    
    console.log('📋 État final des utilisateurs:');
    users.forEach(user => {
      console.log(`   ✓ ID: ${user.id}, Email: ${user.email}, Name: ${user.display_name}, Role: ${user.role}, Active: ${user.is_active ? 'Oui' : 'Non'}`);
    });
    
    console.log('\n✨ Configuration complète! Les utilisateurs sont prêts à se connecter.');
    
  } catch (error) {
    console.error('❌ Erreur:', error.message);
    process.exit(1);
  } finally {
    conn.release();
    await pool.end();
  }
}

createDefaultUsers();
