import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

dotenv.config();

const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'logsystem_v4',
  multipleStatements: true
};

async function checkUserPassword() {
  let connection;
  try {
    console.log('Connexion à la base de données...');
    connection = await mysql.createConnection(dbConfig);
    
    // Vérifier l'utilisateur yannickfoning22@gmail.com
    const [userRows] = await connection.execute(
      'SELECT id, email, password_hash, role, is_active, created_at FROM users WHERE email = ?', 
      ['yannickfoning22@gmail.com']
    );
    
    if (userRows.length === 0) {
      console.log('❌ Utilisateur non trouvé');
      return;
    }
    
    const user = userRows[0];
    console.log('✅ Utilisateur trouvé:');
    console.log(`  ID: ${user.id}`);
    console.log(`  Email: ${user.email}`);
    console.log(`  Rôle: ${user.role}`);
    console.log(`  Actif: ${user.is_active}`);
    console.log(`  Hash présent: ${user.password_hash ? 'Oui' : 'NON'}`);
    
    if (!user.password_hash) {
      console.log('⚠️  L\'utilisateur n\'a pas de mot de passe!');
      
      // Créer un mot de passe par défaut
      const defaultPassword = 'Password123!';
      const saltRounds = parseInt(process.env.BCRYPT_ROUNDS || '12');
      const hashedPassword = await bcrypt.hash(defaultPassword, saltRounds);
      
      await connection.execute(
        'UPDATE users SET password_hash = ? WHERE id = ?', 
        [hashedPassword, user.id]
      );
      
      console.log(`✅ Mot de passe par défaut créé: "${defaultPassword}"`);
    }
    
    if (!user.is_active) {
      console.log('⚠️  L\'utilisateur n\'est pas actif!');
      await connection.execute('UPDATE users SET is_active = 1 WHERE id = ?', [user.id]);
      console.log('✅ Utilisateur activé');
    }
    
    // Tester la connexion
    console.log('\n=== TEST DE CONNEXION ===');
    const testPassword = 'Password123!';
    const isValid = await bcrypt.compare(testPassword, user.password_hash || hashedPassword);
    console.log(`Test avec mot de passe "${testPassword}": ${isValid ? '✅ VALIDE' : '❌ INVALIDE'}`);
    
  } catch (error) {
    console.error('Erreur:', error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

checkUserPassword();
