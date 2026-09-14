import mysql from 'mysql2/promise';

const connection = await mysql.createConnection({
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: '',
  database: 'log'
});

console.log('=== Check OPERATIONAL_TS (imported_at) values ===');

// Check recent FATAL logs with their imported_at values
const [fatalLogs] = await connection.execute(
  'SELECT id, timestamp, imported_at, log_level, message, user_id FROM logs WHERE log_level = "FATAL" ORDER BY id DESC LIMIT 5'
);

console.log('Recent FATAL logs with imported_at:');
fatalLogs.forEach(log => {
  console.log('ID:', log.id, ', timestamp:', log.timestamp, ', imported_at:', log.imported_at, ', user_id:', log.user_id);
});

// Check what OPERATIONAL_TS would give us
const windowStart = new Date(Date.now() - 60 * 60000).toISOString().slice(0, 19).replace('T', ' ');
console.log('\n=== Check using imported_at (OPERATIONAL_TS) ===');
console.log('Window start (60 min ago):', windowStart);

const [fatalByImported] = await connection.execute(
  'SELECT COUNT(*) as cnt FROM logs WHERE imported_at >= ? AND log_level = ? AND user_id = ?',
  [windowStart, 'FATAL', 1]
);

console.log('FATAL logs using imported_at in window:', fatalByImported[0].cnt);

// Compare with timestamp column
const [fatalByTimestamp] = await connection.execute(
  'SELECT COUNT(*) as cnt FROM logs WHERE timestamp >= ? AND log_level = ? AND user_id = ?',
  [windowStart, 'FATAL', 1]
);

console.log('FATAL logs using timestamp in window:', fatalByTimestamp[0].cnt);

console.log('\n=== ISSUE IDENTIFIED ===');
if (fatalByImported[0].cnt === 0 && fatalByTimestamp[0].cnt > 0) {
  console.log('❌ PROBLEM: OPERATIONAL_TS (imported_at) returns 0 logs but timestamp returns', fatalByTimestamp[0].cnt);
  console.log('This means the alert engine is looking at imported_at but our logs have old imported_at values');
} else if (fatalByImported[0].cnt > 0) {
  console.log('✅ OPERATIONAL_TS is working correctly');
} else {
  console.log('⚠️  Both return 0 - no recent FATAL logs in either column');
}

await connection.end();
