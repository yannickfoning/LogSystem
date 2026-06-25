import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PROJECT_ROOT } from '../project-root.js';

dotenv.config();

const RESET_SQL = path.join(PROJECT_ROOT, 'db', 'migrations', 'reset_platform.sql');

const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'logsystem_v4',
  multipleStatements: true
};

async function resetPlatform() {
  let connection;
  try {
    console.log('🔄 Connexion à la base de données...');
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ Connecté à la base de données MySQL');
    
    // Lire le fichier SQL
    console.log('📖 Lecture du fichier reset_platform.sql...');
    const sqlContent = fs.readFileSync(RESET_SQL, 'utf8');
    
    // Diviser et exécuter les commandes SQL une par une
    console.log('⚡ Exécution des commandes de réinitialisation...');
    const statements = sqlContent
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
    
    for (const statement of statements) {
      if (statement.trim()) {
        await connection.execute(statement);
      }
    }
    
    console.log('✅ Plateforme réinitialisée avec succès!');
    console.log('\n📋 Utilisateurs par défaut recréés:');
    console.log('   - admin@logsystem.local (mot de passe: Admin@1234)');
    console.log('   - user@logsystem.local (mot de passe: User@1234)');
    console.log('\n🎯 Vous pouvez maintenant vous connecter avec ces comptes.');
    
  } catch (error) {
    console.error('❌ Erreur lors de la réinitialisation:', error.message);
  } finally {
    if (connection) {
      await connection.end();
      console.log('🔌 Connexion à la base de données fermée');
    }
  }
}

resetPlatform();
