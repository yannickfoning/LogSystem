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

async function checkNewUser() {
  let connection;
  try {
    console.log('Connexion à la base de données...');
    connection = await mysql.createConnection(dbConfig);
    console.log('Connecté à la base de données MySQL');
    
    // Vérifier tous les utilisateurs
    console.log('\n=== TOUS LES UTILISATEURS ===');
    const [users] = await connection.execute('SELECT id, email, role, created_at FROM users ORDER BY created_at DESC');
    users.forEach(user => {
      console.log(`ID: ${user.id}, Email: ${user.email}, Rôle: ${user.role}, Créé: ${user.created_at}`);
    });
    
    // Demander l'email de l'utilisateur à vérifier
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const email = await new Promise(resolve => {
      rl.question('Entrez l\'email de l\'utilisateur à vérifier: ', resolve);
    });
    
    rl.close();
    
    // Vérifier l'utilisateur spécifique
    console.log(`\n=== VÉRIFICATION DE L'UTILISATEUR: ${email} ===`);
    const [userRows] = await connection.execute('SELECT id, email, password_hash, role, is_active, created_at FROM users WHERE email = ?', [email]);
    
    if (userRows.length === 0) {
      console.log('❌ UTILISATEUR NON TROUVÉ dans la base de données');
      return;
    }
    
    const user = userRows[0];
    console.log('✅ UTILISATEUR TROUVÉ:');
    console.log(`  ID: ${user.id}`);
    console.log(`  Email: ${user.email}`);
    console.log(`  Rôle: ${user.role}`);
    console.log(`  Actif: ${user.is_active ? 'Oui' : 'Non'}`);
    console.log(`  Créé: ${user.created_at}`);
    console.log(`  Hash du mot de passe: ${user.password_hash ? 'Présent' : 'ABSENT'}`);
    
    // Si l'utilisateur n'a pas de mot de passe, lui en demander un
    if (!user.password_hash) {
      console.log('\n⚠️  L\'utilisateur n\'a pas de hash de mot de passe!');
      
      const rl2 = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const newPassword = await new Promise(resolve => {
        rl2.question('Entrez un nouveau mot de passe pour cet utilisateur: ', resolve);
      });
      
      rl2.close();
      
      // Hasher et mettre à jour le mot de passe
      const saltRounds = parseInt(process.env.BCRYPT_ROUNDS || '12');
      const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
      
      await connection.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hashedPassword, user.id]);
      console.log('✅ Mot de passe mis à jour avec succès');
    }
    
    // Vérifier si l'utilisateur est actif
    if (!user.is_active) {
      console.log('\n⚠️  L\'utilisateur n\'est pas actif!');
      await connection.execute('UPDATE users SET is_active = 1 WHERE id = ?', [user.id]);
      console.log('✅ Utilisateur activé');
    }
    
  } catch (error) {
    console.error('Erreur:', error.message);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\nConnexion à la base de données fermée');
    }
  }
}

checkNewUser();
