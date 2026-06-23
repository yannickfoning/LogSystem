import '../../config/loadEnv.js';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import readline from 'readline';

const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'logsystem_v4',
  multipleStatements: true
};

async function resetUserPassword() {
  let connection;
  try {
    console.log('Connexion à la base de données...');
    connection = await mysql.createConnection(dbConfig);
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const email = await new Promise(resolve => {
      rl.question('Entrez l\'email de l\'utilisateur: ', resolve);
    });
    
    const newPassword = await new Promise(resolve => {
      rl.question('Entrez le nouveau mot de passe: ', resolve);
    });
    
    rl.close();
    
    // Vérifier si l'utilisateur existe
    const [userRows] = await connection.execute(
      'SELECT id, email FROM users WHERE email = ?', 
      [email]
    );
    
    if (userRows.length === 0) {
      console.log('❌ Utilisateur non trouvé');
      return;
    }
    
    const user = userRows[0];
    console.log(`✅ Utilisateur trouvé: ${user.email} (ID: ${user.id})`);
    
    // Hasher le nouveau mot de passe
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS || '12');
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    
    // Mettre à jour le mot de passe
    await connection.execute(
      'UPDATE users SET password_hash = ?, is_active = 1 WHERE id = ?', 
      [hashedPassword, user.id]
    );
    
    console.log('✅ Mot de passe réinitialisé avec succès');
    console.log(`📧 Email: ${email}`);
    console.log(`🔑 Nouveau mot de passe: ${newPassword}`);
    console.log('\nL\'utilisateur peut maintenant se connecter avec ces identifiants.');
    
  } catch (error) {
    console.error('Erreur:', error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

resetUserPassword();
