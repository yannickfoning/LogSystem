import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'log'
});

const [rules] = await conn.execute('SELECT * FROM alert_rules ORDER BY id DESC LIMIT 5');
console.log('Recent alert rules:');
rules.forEach(r => {
  console.log(`- ID ${r.id}: ${r.name} (${r.condition_type}, active: ${r.is_active})`);
  console.log(`  Condition: ${r.condition_value}, Threshold: ${r.threshold_value}`);
});

await conn.end();