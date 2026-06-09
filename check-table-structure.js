import mysql from 'mysql2/promise';
import fs from 'fs';

const conn = await mysql.createConnection({
  host: 'mysql-aab9c07-yannickfoning22-33d3.d.aivencloud.com',
  port: 21661,
  user: 'avnadmin',
  password: 'AVNS_tflDPmE7FE7dnWKpjFY',
  database: 'defaultdb',
  ssl: { ca: fs.readFileSync('./ca.pem') }
});

// Colonnes attendues par le code
const expectedColumns = [
  'id', 'timestamp', 'created_time', 'imported_at', 'log_level', 
  'source', 'source_server', 'service', 'message', 'normalized_message', 
  'event_type', 'error_type', 'fingerprint', 'user_id', 'target_user', 
  'module', 'parser_format', 'timestamp_inferred', 'created_at'
];

// Vérifier la structure réelle de la table logs
const [columns] = await conn.query('DESCRIBE logs');
console.log('Structure actuelle de la table logs:');
console.table(columns);

const actualColumns = columns.map(col => col.Field);
console.log('\nColonnes présentes:', actualColumns.length);
console.log('Colonnes attendues:', expectedColumns.length);

// Vérifier les colonnes manquantes
const missingColumns = expectedColumns.filter(col => !actualColumns.includes(col));
if (missingColumns.length > 0) {
  console.log('\n❌ Colonnes manquantes:', missingColumns);
} else {
  console.log('\n✅ Toutes les colonnes attendues sont présentes');
}

// Vérifier les colonnes en trop
const extraColumns = actualColumns.filter(col => !expectedColumns.includes(col));
if (extraColumns.length > 0) {
  console.log('\n⚠️ Colonnes supplémentaires:', extraColumns);
}

await conn.end();
