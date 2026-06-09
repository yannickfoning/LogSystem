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

const LOG_COLUMNS = 'id, timestamp, created_time, imported_at, log_level, source, source_server, service, message, normalized_message, event_type, error_type, fingerprint, user_id, target_user, module, parser_format, timestamp_inferred, created_at';

try {
  console.log('🔍 Test de la requête API principale...');
  
  // Simuler la requête que fait l'API pour un admin (pas de filtre user)
  const filterSql = ''; // Pas de filtre pour admin
  const filterParams = [];
  const limitVal = 50;
  const sortBy = 'timestamp';
  const orderBy = 'DESC';
  
  const sql = `SELECT ${LOG_COLUMNS} FROM logs WHERE 1=1 ${filterSql} ORDER BY ${sortBy} ${orderBy} LIMIT ${limitVal + 1}`;
  const params = filterParams;
  
  console.log('SQL:', sql);
  console.log('Params:', params);
  
  const [rows] = await conn.execute(sql, params);
  console.log(`✅ Requête réussie - ${rows.length} logs retournés`);
  console.table(rows.slice(0, 5)); // Afficher les 5 premiers
  
} catch (error) {
  console.log('❌ Erreur lors de la requête:');
  console.error('Message:', error.message);
  console.error('Code:', error.code);
  console.error('SQL State:', error.sqlState);
}

await conn.end();
