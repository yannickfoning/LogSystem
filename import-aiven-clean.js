import mysql from 'mysql2/promise';
import fs from 'fs';

const conn = await mysql.createConnection({
  host: 'mysql-aab9c07-yannickfoning22-33d3.d.aivencloud.com',
  port: 21661,
  user: 'avnadmin',
  password: 'AVNS_tflDPmE7FE7dnWKpjFY',
  database: 'defaultdb',
  ssl: { ca: fs.readFileSync('./ca.pem') },
  multipleStatements: true
});

console.log('🧹 Nettoyage de la base de données...');

// Désactiver les contrôles de clé étrangère et la contrainte de clé primaire
await conn.query('SET FOREIGN_KEY_CHECKS = 0');
await conn.query('SET SESSION sql_require_primary_key = 0');

// Lister toutes les tables
const [tables] = await conn.query('SHOW TABLES');
const tableNames = tables.map(row => Object.values(row)[0]);

// Supprimer toutes les tables existantes
for (const table of tableNames) {
  await conn.query(`DROP TABLE IF EXISTS \`${table}\``);
  console.log(`🗑️ Table ${table} supprimée`);
}

console.log('📦 Import en cours...');
const sql = fs.readFileSync('./db/log.sql', 'utf8');

// Supprimer toutes les définitions de contraintes de clé étrangère du SQL
const cleanSql = sql.replace(/,\s*CONSTRAINT\s+`[^`]+`\s+FOREIGN\s+KEY\s+\([^)]+\)\s+REFERENCES\s+`[^`]+`\s*\([^)]+\)(?:\s+ON\s+DELETE\s+(?:CASCADE|SET\s+NULL|NO\s+ACTION|RESTRICT))?(?:\s+ON\s+UPDATE\s+(?:CASCADE|SET\s+NULL|NO\s+ACTION|RESTRICT))?/gi, '');

// Remplacer tous les blocs ALTER TABLE qui ajoutent des contraintes de clé étrangère
const finalSql = cleanSql.replace(/--\s*Contraintes pour la table[^-]+ALTER TABLE[^;]+;/gi, '');

await conn.query(finalSql);
await conn.query('SET FOREIGN_KEY_CHECKS = 1');
console.log('✅ Import terminé avec succès !');
await conn.end();
