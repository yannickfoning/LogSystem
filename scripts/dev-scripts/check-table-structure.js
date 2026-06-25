import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'logsystem_v4',
  multipleStatements: true
};

async function checkTableStructure() {
  let connection;
  try {
    console.log('🔍 Vérification de la structure des tables...');
    connection = await mysql.createConnection(dbConfig);
    
    // Vérifier la structure de la table alert_rules
    const [alertRulesStructure] = await connection.execute('DESCRIBE alert_rules');
    console.log('\n📋 Structure de la table alert_rules:');
    alertRulesStructure.forEach(column => {
      console.log(`  ${column.Field}: ${column.Type} ${column.Null === 'NO' ? 'NOT NULL' : 'NULL'} ${column.Key ? '(' + column.Key + ')' : ''}`);
    });
    
  } catch (error) {
    console.error('❌ Erreur:', error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

checkTableStructure();
