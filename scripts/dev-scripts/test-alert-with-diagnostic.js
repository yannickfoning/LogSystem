import mysql from 'mysql2/promise';
import fs from 'fs';

const connection = await mysql.createConnection({
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: '',
  database: 'log'
});

console.log('=== Test with fresh FATAL log to trigger diagnostic logs ===');

// Get current alerts state
const [beforeAlerts] = await connection.execute(
  'SELECT id, rule_id, created_at FROM alerts ORDER BY id DESC LIMIT 3'
);
const latestAlertId = beforeAlerts.length > 0 ? beforeAlerts[0].id : 0;

console.log('Current latest alert ID:', latestAlertId);

// Insert a fresh FATAL log with current timestamp
const now = new Date();
const currentTimestamp = now.toISOString().slice(0, 19).replace('T', ' ');
const testLogContent = `${currentTimestamp} FATAL DIAGNOSTIC TEST - Current time\nERROR Context`;
const testFileName = `logs/diag-fatal-${Date.now()}.log`;

fs.writeFileSync(testFileName, testLogContent);
console.log('Test log created with current timestamp:', currentTimestamp);

// Wait for next alert evaluation cycle (60 seconds)
console.log('Waiting 65 seconds for next alert evaluation cycle...');
await new Promise(resolve => setTimeout(resolve, 65000));

// Check for new alerts
const [afterAlerts] = await connection.execute(
  'SELECT id, rule_id, created_at, message FROM alerts WHERE id > ? ORDER BY id DESC',
  [latestAlertId]
);

console.log('New alerts created:', afterAlerts.length);
if (afterAlerts.length > 0) {
  afterAlerts.forEach(alert => {
    const msg = alert.message.length > 60 ? alert.message.substring(0, 60) + '...' : alert.message;
    console.log('ID:', alert.id, ', Rule_ID:', alert.rule_id, ', Created:', alert.created_at, ', Message:', msg);
  });
} else {
  console.log('No new alerts created');
}

// Cleanup
fs.unlinkSync(testFileName);

await connection.end();
