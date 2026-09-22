import pool from './config/database.js';
import bcrypt from 'bcryptjs';

async function createTestUser() {
  try {
    // Vérifier si l'utilisateur admin existe
    const [existingUsers] = await pool.execute(
      'SELECT * FROM users WHERE email = ?',
      ['admin@logsystem.com']
    );
    
    if (existingUsers.length > 0) {
      console.log('✅ Utilisateur admin existe déjà');
      console.log('Email:', existingUsers[0].email);
      console.log('Role:', existingUsers[0].role);
      return;
    }
    
    // Créer l'utilisateur admin
    const hashedPassword = await bcrypt.hash('admin123', 10);
    
    await pool.execute(
      `INSERT INTO users (email, password_hash, display_name, role, is_active) 
       VALUES (?, ?, ?, ?, ?)`,
      ['admin@logsystem.com', hashedPassword, 'Admin User', 'admin', 1]
    );
    
    console.log('✅ Utilisateur admin créé avec succès');
    console.log('Email: admin@logsystem.com');
    console.log('Password: admin123');
    
  } catch (error) {
    console.error('❌ Erreur:', error.message);
  } finally {
    await pool.end();
  }
}

createTestUser();