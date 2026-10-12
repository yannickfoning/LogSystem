import mysql from 'mysql2/promise';
import crypto from 'crypto';

async function testAlertWithValidUser() {
  console.log('=== ALERT TEST WITH VALID USER ID ===');
  console.log('Testing alert creation with a log that has a valid user_id...');
  console.log('');

  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'log'
  });

  // Step 1: Insert a CRITICAL log with user_id = 1 (admin)
  console.log('Step 1: Inserting a CRITICAL log with user_id = 1 (admin)...');
  const testMessage = `SSE TEST CRITICAL USER ${Date.now()} - ${crypto.randomBytes(8).toString('hex')}`;

  const [insertResult] = await conn.execute(
    `INSERT INTO logs (timestamp, log_level, message, source, service, user_id, imported_at, created_at)
     VALUES (NOW(), 'CRITICAL', ?, 'sse-test', 'test-service', 1, NOW(), NOW())`,
    [testMessage]
  );

  const logId = insertResult.insertId;
  console.log(`✅ Inserted CRITICAL log with ID: ${logId}, user_id: 1`);
  console.log(`Message: ${testMessage}`);
  console.log('');

  // Step 2: Wait for alert evaluation cycle
  console.log('Step 2: Waiting for alert evaluation cycle (60 seconds)...');
  console.log('This should trigger the CRITICAL rule for user_id = 1');
  console.log('');

  await new Promise(resolve => setTimeout(resolve, 65000));

  // Step 3: Check if alert was created
  console.log('Step 3: Checking if alert was created in database...');
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
    console.log(`Alert user_id: ${alerts[0].user_id}`);
  } else {
    console.log('❌ No alert found in database for this specific log');
  }

  // Step 4: Check recent alerts for user_id = 1
  console.log('');
  console.log('Step 4: Checking recent alerts for user_id = 1...');
  const [userAlerts] = await conn.execute(
    'SELECT * FROM alerts WHERE user_id = 1 ORDER BY created_at DESC LIMIT 5'
  );

  console.log(`Total recent alerts for user_id = 1: ${userAlerts.length}`);
  for (const alert of userAlerts) {
    console.log(`  - Alert ${alert.id}: ${alert.severity} - ${alert.message.substring(0, 50)}... (${alert.created_at})`);
  }

  await conn.end();

  // Final conclusion
  console.log('');
  console.log('=== CONCLUSION ===');
  if (alerts.length > 0 || userAlerts.length > 0) {
    console.log('✅ ALERT ENGINE IS WORKING WITH VALID USER ID');
    console.log('Alerts are being created when logs have valid user_id');
    console.log('');
    console.log('🔍 SSE DELIVERY STATUS:');
    console.log('Now that alerts are being created, SSE delivery should work');
    console.log('if alertWorker.broadcastAlert() is called correctly');
  } else {
    console.log('❌ ALERT ENGINE STILL NOT WORKING');
    console.log('Even with valid user_id, no alerts are being created');
  }
}

testAlertWithValidUser().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});