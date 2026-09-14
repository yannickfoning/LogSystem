import mysql from 'mysql2/promise';

const connection = await mysql.createConnection({
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: '',
  database: 'log'
});

console.log('=== Check FATAL rule time window ===');
const [fatalRule] = await connection.execute(
  'SELECT id, name, condition_type, condition_value, threshold_value, time_window_minutes FROM alert_rules WHERE condition_value = "FATAL" AND is_active = 1'
);

if (fatalRule.length > 0) {
  fatalRule.forEach(rule => {
    console.log('ID:', rule.id, ', Name:', rule.name, ', Time window:', rule.time_window_minutes, 'minutes');
  });
} else {
  console.log('No FATAL rule found');
}

console.log('\n=== Check FATAL logs with their timestamps ===');
const [fatalLogs] = await connection.execute(
  'SELECT id, timestamp, log_level, message, user_id FROM logs WHERE log_level = "FATAL" ORDER BY id DESC'
);

console.log('All FATAL logs:', fatalLogs.length);
fatalLogs.forEach(log => {
  console.log('ID:', log.id, ', Time:', log.timestamp, ', User_ID:', log.user_id, ', Message:', log.message.substring(0, 50) + '...');
});

console.log('\n=== Test: Insert FATAL log and immediately check alert ===');
const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
const fs = await import('fs');
const testLogContent = `${timestamp} FATAL IMMEDIATE TEST - Should trigger alert immediately\n${timestamp} ERROR Context`;
const testFileName = `logs/test-immediate-fatal-${Date.now()}.log`;

fs.writeFileSync(testFileName, testLogContent);
console.log('Test log created:', testFileName);

// Wait 5 seconds for immediate processing
console.log('Waiting 5 seconds for processing...');
await new Promise(resolve => setTimeout(resolve, 5000));

// Check for new alerts
const [latestAlerts] = await connection.execute(
  'SELECT id, rule_id, created_at, message FROM alerts ORDER BY id DESC LIMIT 3'
);
console.log('Latest alerts after immediate test:');
latestAlerts.forEach(alert => {
  console.log('ID:', alert.id, ', Rule_ID:', alert.rule_id, ', Created:', alert.created_at, ', Message:', alert.message.substring(0, 60) + '...');
});

// Cleanup
fs.unlinkSync(testFileName);
console.log('Test file removed');

await connection.end();
