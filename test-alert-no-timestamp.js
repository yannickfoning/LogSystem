import mysql from 'mysql2/promise';
import fs from 'fs';

const connection = await mysql.createConnection({
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: '',
  database: 'log'
});

console.log('=== STEP 1: Get current alerts state ===');
const [beforeAlerts] = await connection.execute(
  'SELECT id, rule_id, created_at, message FROM alerts ORDER BY id DESC LIMIT 3'
);
console.log('Current alerts (latest 3):');
beforeAlerts.forEach(alert => {
  const msg = alert.message.length > 50 ? alert.message.substring(0, 50) + '...' : alert.message;
  console.log('ID:', alert.id, ', Rule_ID:', alert.rule_id, ', Created:', alert.created_at, ', Message:', msg);
});

const latestAlertId = beforeAlerts.length > 0 ? beforeAlerts[0].id : 0;

console.log('\n=== STEP 2: Insert FATAL log WITHOUT explicit timestamp ===');
// No timestamp in log - system should use import time
const testLogContent = `FATAL TEST ALERT NO TIMESTAMP - This should use import time\nERROR Context for fatal`;
const testFileName = `logs/test-no-timestamp-${Date.now()}.log`;

fs.writeFileSync(testFileName, testLogContent);
console.log('Test log file created:', testFileName);
console.log('Log content (no timestamp):', testLogContent);

console.log('\n=== STEP 3: Wait for alert engine evaluation ===');
console.log('Waiting 65 seconds for full evaluation cycle...');
await new Promise(resolve => setTimeout(resolve, 65000));

console.log('\n=== STEP 4: Check for NEW alerts ===');
const [afterAlerts] = await connection.execute(
  'SELECT id, rule_id, created_at, message, user_id FROM alerts WHERE id > ? ORDER BY id DESC',
  [latestAlertId]
);

console.log('New alerts created:', afterAlerts.length);

if (afterAlerts.length > 0) {
  console.log('✅ SUCCESS: New alert(s) triggered!');
  afterAlerts.forEach(alert => {
    const msg = alert.message.length > 80 ? alert.message.substring(0, 80) + '...' : alert.message;
    console.log('ID:', alert.id, ', Rule_ID:', alert.rule_id, ', Created:', alert.created_at, ', User_ID:', alert.user_id, ', Message:', msg);
  });
} else {
  console.log('❌ FAILED: No new alerts triggered');
  
  // Check what happened to the log
  const [recentLogs] = await connection.execute(
    'SELECT id, timestamp, log_level, message, user_id, imported_at FROM logs WHERE message LIKE "%NO TIMESTAMP%" ORDER BY id DESC LIMIT 3'
  );
  console.log('Recent test logs:');
  recentLogs.forEach(log => {
    console.log('ID:', log.id, ', Timestamp:', log.timestamp, ', Imported_at:', log.imported_at, ', Level:', log.log_level, ', User_ID:', log.user_id);
  });
}

// Cleanup
fs.unlinkSync(testFileName);
console.log('\n=== Cleanup: Test file removed ===');

await connection.end();

console.log('\n=== TEST SUMMARY ===');
if (afterAlerts.length > 0) {
  console.log('✅ ALERT TRIGGERING: SUCCESS - Alert triggered using import time');
} else {
  console.log('❌ ALERT TRIGGERING: FAILED - No alert triggered even with import time');
}
