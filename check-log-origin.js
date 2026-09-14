import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'log'
});

const [logs] = await conn.execute('SELECT source, source_type, created_at, imported_at FROM logs LIMIT 15');
console.log('Origine des 15 logs actuels:');
logs.forEach((log, i) => {
  console.log(i + 1 + '. source: ' + log.source + ', source_type: ' + log.source_type + ', created_at: ' + log.created_at + ', imported_at: ' + log.imported_at);
});

await conn.end();