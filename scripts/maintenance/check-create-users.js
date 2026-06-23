import '../../config/loadEnv.js';
import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'log',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function checkAndCreateUsers() {
  try {
    console.log('🔍 Vérification des utilisateurs...\n');
    
    // Vérifier la structure de la table users
    const [tables] = await pool.query(`
      SELECT TABLE_NAME FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = DATABASE()
    `);
    
    const hasUsersTable = tables.some(t => t.TABLE_NAME === 'users');
    if (!hasUsersTable) {
      console.log('❌ Table "users" n\'existe pas! Création...');
      await pool.query(`
        CREATE TABLE users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          email VARCHAR(255) UNIQUE NOT NULL,
          password VARCHAR(255) NOT NULL,
          name VARCHAR(255),
          role VARCHAR(50) DEFAULT 'user',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('✅ Table "users" créée avec succès\n');
    } else {
      console.log('✅ Table "users" existe\n');
    }
    
    // Vérifier les utilisateurs existants
    const [existingUsers] = await pool.query(`
      SELECT id, email, role FROM users ORDER BY id
    `);
    
    console.log('📋 Utilisateurs actuels:');
    if (existingUsers.length === 0) {
      console.log('   (Aucun utilisateur trouvé)');
    } else {
      existingUsers.forEach(user => {
        console.log(`   - ID: ${user.id}, Email: ${user.email}, Role: ${user.role}`);
      });
    }
    console.log('');
    
    // Créer les utilisateurs par défaut s'ils n'existent pas
    const adminExists = existingUsers.some(u => u.email === 'admin@logsystem.local');
    const userExists = existingUsers.some(u => u.email === 'user@logsystem.local');
    
    if (!adminExists) {
      console.log('➕ Création de l\'utilisateur admin...');
      // Utiliser bcryptjs pour hasher le mot de passe
      const bcrypt = await import('bcryptjs');
      const hashedPassword = await bcrypt.hash('admin123', 10);
      
      await pool.query(`
        INSERT INTO users (email, password, name, role)
        VALUES (?, ?, ?, ?)
      `, ['admin@logsystem.local', hashedPassword, 'Administrator', 'admin']);
      console.log('✅ Utilisateur admin créé (email: admin@logsystem.local, password: admin123)\n');
    } else {
      console.log('✅ Utilisateur admin existe déjà\n');
    }
    
    if (!userExists) {
      console.log('➕ Création de l\'utilisateur user...');
      const bcrypt = await import('bcryptjs');
      const hashedPassword = await bcrypt.hash('user123', 10);
      
      await pool.query(`
        INSERT INTO users (email, password, name, role)
        VALUES (?, ?, ?, ?)
      `, ['user@logsystem.local', hashedPassword, 'User', 'user']);
      console.log('✅ Utilisateur user créé (email: user@logsystem.local, password: user123)\n');
    } else {
      console.log('✅ Utilisateur user existe déjà\n');
    }
    
    // Afficher les utilisateurs finaux
    const [finalUsers] = await pool.query(`
      SELECT id, email, name, role FROM users ORDER BY id
    `);
    
    console.log('📊 État final des utilisateurs:');
    finalUsers.forEach(user => {
      console.log(`   ✓ ${user.name} (${user.email}) - Role: ${user.role}`);
    });
    
    console.log('\n✨ Configuration complète!');
    
  } catch (error) {
    console.error('❌ Erreur:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

checkAndCreateUsers();
