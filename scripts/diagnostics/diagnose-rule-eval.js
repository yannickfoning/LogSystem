import mysql from 'mysql2/promise';

const connection = await mysql.createConnection({
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: '',
  database: 'log'
});

console.log('=== Direct rule evaluation diagnostic ===');

// Get FATAL rule (ID 107) - level type with threshold 1
const [rules] = await connection.execute(
  'SELECT id, name, condition_type, condition_value, threshold_value, time_window_minutes FROM alert_rules WHERE id = 107'
);

if (rules.length === 0) {
  console.log('Rule ID 107 not found');
  await connection.end();
  process.exit(1);
}

const rule = rules[0];
console.log('Testing rule:', rule.name, 'ID:', rule.id);
console.log('Type:', rule.condition_type, ', Value:', rule.condition_value, ', Threshold:', rule.threshold_value, ', Window:', rule.time_window_minutes, 'min');

// Check for FATAL logs in the time window
const userId = 1;
const windowStart = new Date(Date.now() - rule.time_window_minutes * 60000).toISOString().slice(0, 19).replace('T', ' ');

console.log('\n=== Check FATAL logs in time window ===');
console.log('Window start:', windowStart);
console.log('User ID:', userId);

const [fatalLogs] = await connection.execute(
  'SELECT COUNT(*) as cnt FROM logs WHERE timestamp >= ? AND log_level = ? AND user_id = ?',
  [windowStart, 'FATAL', userId]
);

console.log('FATAL logs in window:', fatalLogs[0].cnt);
console.log('Threshold:', rule.threshold_value);

if (fatalLogs[0].cnt >= rule.threshold_value) {
  console.log('✅ RULE SHOULD TRIGGER: Count meets threshold');
} else {
  console.log('❌ RULE SHOULD NOT TRIGGER: Count below threshold');
}

// Check all FATAL logs regardless of time
console.log('\n=== Check ALL FATAL logs for user 1 ===');
const [allFatal] = await connection.execute(
  'SELECT id, timestamp, log_level, message FROM logs WHERE log_level = "FATAL" AND user_id = 1 ORDER BY id DESC'
);

console.log('Total FATAL logs:', allFatal.length);
allFatal.forEach(log => {
  const msg = log.message.length > 50 ? log.message.substring(0, 50) + '...' : log.message;
  console.log('ID:', log.id, ', Time:', log.timestamp, ', Message:', msg);
});

// Insert a fresh FATAL log and immediately check
console.log('\n=== Insert fresh FATAL log and check ===');
const fs = await import('fs');
const now = new Date();
const currentTimestamp = now.toISOString().slice(0, 19).replace('T', ' ');
const testLogContent = `${currentTimestamp} FATAL DIAGNOSTIC TEST - Current time log\nERROR Context`;
const testFileName = `logs/diag-fatal-${Date.now()}.log`;

fs.writeFileSync(testFileName, testLogContent);
console.log('Test log created with current timestamp:', currentTimestamp);

// Wait 5 seconds for processing
await new Promise(resolve => setTimeout(resolve, 5000));

// Check again
const [afterFatal] = await connection.execute(
  'SELECT COUNT(*) as cnt FROM logs WHERE timestamp >= ? AND log_level = ? AND user_id = ?',
  [windowStart, 'FATAL', userId]
);

console.log('FATAL logs in window after insertion:', afterFatal[0].cnt);

if (afterFatal[0].cnt >= rule.threshold_value) {
  console.log('✅ RULE SHOULD TRIGGER NOW: Count meets threshold');
} else {
  console.log('❌ RULE STILL SHOULD NOT TRIGGER: Count still below threshold');
}

// Cleanup
fs.unlinkSync(testFileName);

await connection.end();
