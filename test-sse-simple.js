import mysql from 'mysql2/promise';
import crypto from 'crypto';

async function testAlertCreationAndSSE() {
  console.log('=== ALERT CREATION & SSE TEST ===');
  console.log('Testing if alerts are created and broadcasted via SSE...');
  console.log('');

  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'log'
  });

  // Step 1: Check alert rules
  console.log('Step 1: Checking alert rules...');
  const [rules] = await conn.execute(
    'SELECT id, name, condition_type, condition_value, threshold_value, time_window_minutes FROM alert_rules WHERE is_active = 1 LIMIT 3'
  );

  console.log(`Found ${rules.length} active alert rules:`);
  for (const rule of rules) {
    console.log(`  - Rule ${rule.id}: ${rule.name} (${rule.condition_type}=${rule.condition_value}, threshold=${rule.threshold_value})`);
  }
  console.log('');

  // Step 2: Insert a CRITICAL log
  console.log('Step 2: Inserting a CRITICAL log...');
  const testMessage = `SSE TEST CRITICAL ${Date.now()} - ${crypto.randomBytes(8).toString('hex')}`;

  const [insertResult] = await conn.execute(
    `INSERT INTO logs (timestamp, log_level, message, source, service, imported_at, created_at)
     VALUES (NOW(), 'CRITICAL', ?, 'sse-test', 'test-service', NOW(), NOW())`,
    [testMessage]
  );

  const logId = insertResult.insertId;
  console.log(`✅ Inserted CRITICAL log with ID: ${logId}`);
  console.log(`Message: ${testMessage}`);
  console.log('');

  // Step 3: Wait for alert evaluation cycle
  console.log('Step 3: Waiting for alert evaluation cycle (60 seconds)...');
  console.log('Alert evaluation interval: 60000ms (60 seconds)');
  console.log('');

  await new Promise(resolve => setTimeout(resolve, 65000)); // Wait a bit longer than the interval

  // Step 4: Check if alert was created
  console.log('Step 4: Checking if alert was created in database...');
  const [alerts] = await conn.execute(
    'SELECT * FROM alerts WHERE message LIKE ? ORDER BY created_at DESC LIMIT 1',
    [`%${testMessage}%`]
  );

  if (alerts.length > 0) {
    console.log('✅ Alert was created in database');
    console.log(`Alert ID: ${alerts[0].id}`);
    console.log(`Alert created at: ${alerts[0].created_at}`);
    console.log(`Alert severity: ${alerts[0].severity}`);
    console.log(`Alert message: ${alerts[0].message}`);
  } else {
    console.log('❌ No alert found in database');
    console.log('This indicates the alert engine evaluation is not working');
  }

  // Step 5: Check recent alerts regardless of message
  console.log('');
  console.log('Step 5: Checking recent alerts in database...');
  const [recentAlerts] = await conn.execute(
    'SELECT * FROM alerts ORDER BY created_at DESC LIMIT 5'
  );

  console.log(`Total recent alerts in database: ${recentAlerts.length}`);
  for (const alert of recentAlerts) {
    console.log(`  - Alert ${alert.id}: ${alert.severity} - ${alert.message.substring(0, 50)}... (${alert.created_at})`);
  }

  // Step 6: Check if alertWorker is supposed to broadcast
  console.log('');
  console.log('Step 6: Checking alertWorker code...');
  console.log('According to alertWorker.js line 160-204:');
  console.log('- broadcastAlert() is called when an alert is created');
  console.log('- It should broadcast to all connected SSE clients');
  console.log('- The broadcast happens immediately after alert creation');
  console.log('');

  await conn.end();

  // Final conclusion
  console.log('=== CONCLUSION ===');
  if (alerts.length > 0) {
    console.log('✅ ALERT ENGINE IS WORKING');
    console.log('Alerts are being created in database');
    console.log('');
    console.log('🔍 SSE DELIVERY STATUS:');
    console.log('Based on code analysis, alertWorker.broadcastAlert() should be called');
    console.log('when an alert is created (alertEngine.js line 327)');
    console.log('');
    console.log('NEXT STEPS TO CONFIRM SSE:');
    console.log('1. Open a real browser SSE connection to /api/alerts/stream');
    console.log('2. Insert a CRITICAL log while connection is open');
    console.log('3. Wait 60 seconds for alert evaluation cycle');
    console.log('4. Observe if alert event is received on SSE connection');
  } else {
    console.log('❌ ALERT ENGINE IS NOT WORKING');
    console.log('No alerts are being created in database');
    console.log('This needs to be fixed before SSE can be tested');
  }
}

testAlertCreationAndSSE().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});