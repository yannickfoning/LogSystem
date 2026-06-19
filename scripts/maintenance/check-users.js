import '../../config/loadEnv.js';
import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: 'log'
});

const conn = await pool.getConnection();

// Vérifier les colonnes de la table users d'abord
const [columns] = await conn.query(`
  SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'log' AND TABLE_NAME = 'users'
  ORDER BY ORDINAL_POSITION
`);

console.log('📊 Structure de la table users:');
columns.forEach(col => {
  console.log(`   - ${col.COLUMN_NAME}: ${col.COLUMN_TYPE} ${col.IS_NULLABLE === 'NO' ? 'NOT NULL' : 'NULL'} ${col.COLUMN_KEY ? `[${col.COLUMN_KEY}]` : ''}`);
});
console.log('');

// Récupérer les utilisateurs avec colonnes disponibles
const [users] = await conn.query(`
  SELECT * FROM users ORDER BY id
`);

console.log('📋 Utilisateurs actuels:');
if (users.length === 0) {
  console.log('   (Aucun utilisateur trouvé)\n');
} else {
  users.forEach(user => {
    console.log(`   ✓ ${JSON.stringify(user)}`);
  });
  console.log('');
}

conn.release();
await pool.end();
