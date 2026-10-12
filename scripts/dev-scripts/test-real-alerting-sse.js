import mysql from 'mysql2/promise';
import fs from 'fs';

const connection = await mysql.createConnection({
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: '',
  database: 'log'
});

console.log('=== STEP 1: Check existing alert rules ===');
const [rules] = await connection.execute(
  'SELECT id, name, condition_type, condition_value, threshold_value, time_window_minutes FROM alert_rules WHERE is_active = 1 ORDER BY id'
);

console.log('Active alert rules:', rules.length);
rules.forEach(rule => {
  console.log('ID:', rule.id, ', Name:', rule.name, ', Type:', rule.condition_type, ', Value:', rule.condition_value, ', Threshold:', rule.threshold_value);
});

// Find a suitable rule for testing (not log_inactivity)
const testRule = rules.find(r => r.condition_type === 'log_level' && r.condition_value === 'ERROR');
if (!testRule) {
  console.log('No suitable ERROR-level rule found, will use rule with condition_type based on level');
}

console.log('\n=== STEP 2: Get current alerts state ===');
const [beforeAlerts] = await connection.execute(
  'SELECT id, rule_id, created_at, message FROM alerts ORDER BY id DESC LIMIT 5'
);
console.log('Current alerts (latest 5):');
beforeAlerts.forEach(alert => {
  console.log('ID:', alert.id, ', Rule_ID:', alert.rule_id, ', Created:', alert.created_at, ', Message:', alert.message.substring(0, 50) + '...');
});

const latestAlertId = beforeAlerts.length > 0 ? beforeAlerts[0].id : 0;
const latestAlertTime = beforeAlerts.length > 0 ? beforeAlerts[0].created_at : null;

console.log('\n=== STEP 3: Insert a new ERROR log that should trigger alert ===');
const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
const testLogContent = `${timestamp} ERROR REAL TEST ALERT - This should trigger a new alert\n${timestamp} INFO Context log for the error`;
const testFileName = `logs/test-real-alert-${Date.now()}.log`;

fs.writeFileSync(testFileName, testLogContent);
console.log('Test log file created:', testFileName);
console.log('Log content:', testLogContent);

console.log('\n=== STEP 4: Wait for alert engine evaluation cycle ===');
// Check ALERT_EVAL_INTERVAL from .env or default to 60000ms
const evalInterval = 60000; // 60 seconds as per .env
console.log('Alert evaluation interval:', evalInterval, 'ms');
console.log('Waiting for evaluation cycle...');

// Wait in increments to show progress
for (let i = 0; i < 6; i++) {
  await new Promise(resolve => setTimeout(resolve, 10000)); // 10 seconds
  console.log(`Waited ${(i + 1) * 10} seconds...`);
}

console.log('\n=== STEP 5: Check for NEW alerts ===');
const [afterAlerts] = await connection.execute(
  'SELECT id, rule_id, created_at, message, user_id FROM alerts WHERE id > ? ORDER BY id DESC',
  [latestAlertId]
);

console.log('New alerts created since test log insertion:', afterAlerts.length);

if (afterAlerts.length > 0) {
  console.log('✅ SUCCESS: New alert(s) triggered!');
  afterAlerts.forEach(alert => {
    console.log('ID:', alert.id, ', Rule_ID:', alert.rule_id, ', Created:', alert.created_at, ', User_ID:', alert.user_id, ', Message:', alert.message.substring(0, 80) + '...');
  });
  
  // Calculate timing
  const insertionTime = new Date(timestamp);
  const alertTime = new Date(afterAlerts[0].created_at);
  const delay = alertTime - insertionTime;
  console.log('Time from log insertion to alert creation:', delay, 'ms');
  
} else {
  console.log('❌ FAILED: No new alerts triggered');
  console.log('Checking all alerts to see what happened...');
  const [allAlerts] = await connection.execute(
    'SELECT id, rule_id, created_at, message FROM alerts ORDER BY id DESC LIMIT 10'
  );
  console.log('Latest 10 alerts in database:');
  allAlerts.forEach(alert => {
    console.log('ID:', alert.id, ', Rule_ID:', alert.rule_id, ', Created:', alert.created_at, ', Message:', alert.message.substring(0, 50) + '...');
  });
}

console.log('\n=== STEP 6: Check recent logs with user_id ===');
const [recentLogs] = await connection.execute(
  'SELECT id, timestamp, log_level, message, user_id FROM logs WHERE message LIKE "%REAL TEST ALERT%" ORDER BY id DESC LIMIT 3'
);
console.log('Recent test logs:');
recentLogs.forEach(log => {
  console.log('ID:', log.id, ', Time:', log.timestamp, ', Level:', log.log_level, ', User_ID:', log.user_id, ', Message:', log.message.substring(0, 50) + '...');
});

// Cleanup
fs.unlinkSync(testFileName);
console.log('\n=== Cleanup: Test file removed ===');

await connection.end();

console.log('\n=== TEST SUMMARY ===');
if (afterAlerts.length > 0) {
  console.log('✅ ALERT TRIGGERING: SUCCESS - New alert created with proper timing');
  console.log('Note: SSE end-to-end testing requires a separate client connection maintained during the process');
} else {
  console.log('❌ ALERT TRIGGERING: FAILED - No new alert triggered');
  console.log('This indicates either:');
  console.log('1. Alert engine evaluation cycle not completed');
  console.log('2. No matching alert rule for the test log');
  console.log('3. Alert rule cooldown period not expired');
  console.log('4. User_id filtering preventing alert creation');
}
