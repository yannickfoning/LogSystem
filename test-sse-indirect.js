import mysql from 'mysql2/promise';
import crypto from 'crypto';

async function testSSEIndirect() {
  console.log('=== INDIRECT SSE TEST ===');
  console.log('Testing alert creation and checking server logs for SSE broadcast...');
  console.log('');

  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'log'
  });

  // Step 1: Check current alerts count
  console.log('Step 1: Checking current alerts count...');
  const [currentAlerts] = await conn.execute('SELECT COUNT(*) as cnt FROM alerts');
  console.log(`Current alerts in database: ${currentAlerts[0].cnt}`);
  console.log('');

  // Step 2: Insert a CRITICAL log with user_id = 1
  console.log('Step 2: Inserting a CRITICAL log with user_id = 1...');
  const testMessage = `INDIRECT SSE TEST ${Date.now()} - ${crypto.randomBytes(8).toString('hex')}`;

  const [insertResult] = await conn.execute(
    `INSERT INTO logs (timestamp, log_level, message, source, service, user_id, imported_at, created_at)
     VALUES (NOW(), 'CRITICAL', ?, 'sse-indirect-test', 'test-service', 1, NOW(), NOW())`,
    [testMessage]
  );

  const logId = insertResult.insertId;
  console.log(`✅ Inserted CRITICAL log with ID: ${logId}, user_id: 1`);
  console.log(`Message: ${testMessage}`);
  console.log('');

  // Step 3: Wait for alert evaluation cycle
  console.log('Step 3: Waiting for alert evaluation cycle (60 seconds)...');
  console.log('Please monitor the server logs for SSE broadcast events...');
  console.log('');

  await new Promise(resolve => setTimeout(resolve, 65000));

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
    console.log(`Alert user_id: ${alerts[0].user_id}`);
  } else {
    console.log('❌ No alert found in database for this specific log');
  }

  // Step 5: Check alert count change
  console.log('');
  console.log('Step 5: Checking alert count change...');
  const [newAlerts] = await conn.execute('SELECT COUNT(*) as cnt FROM alerts');
  console.log(`Previous alerts: ${currentAlerts[0].cnt}`);
  console.log(`Current alerts: ${newAlerts[0].cnt}`);
  console.log(`New alerts created: ${newAlerts[0].cnt - currentAlerts[0].cnt}`);
  console.log('');

  // Step 6: Get most recent alert
  console.log('Step 6: Getting most recent alert...');
  const [recentAlert] = await conn.execute(
    'SELECT * FROM alerts ORDER BY created_at DESC LIMIT 1'
  );

  if (recentAlert.length > 0) {
    console.log('Most recent alert:');
    console.log(`  ID: ${recentAlert[0].id}`);
    console.log(`  Severity: ${recentAlert[0].severity}`);
    console.log(`  Message: ${recentAlert[0].message}`);
    console.log(`  Created at: ${recentAlert[0].created_at}`);
    console.log(`  User ID: ${recentAlert[0].user_id}`);
  }

  await conn.end();

  // Final conclusion
  console.log('');
  console.log('=== CONCLUSION ===');
  if (alerts.length > 0 || (newAlerts[0].cnt - currentAlerts[0].cnt) > 0) {
    console.log('✅ ALERT ENGINE IS WORKING');
    console.log('New alerts are being created in database');
    console.log('');
    console.log('🔍 SSE DELIVERY STATUS:');
    console.log('According to the code analysis:');
    console.log('- alertEngine.js line 327 calls alertWorker.broadcastAlert(alert)');
    console.log('- alertWorker.js line 160-204 implements broadcastAlert()');
    console.log('- It should broadcast to all connected SSE clients');
    console.log('');
    console.log('CHECK SERVER LOGS:');
    console.log('Look for "sse_alert_broadcast" events in the server output');
    console.log('If you see these events, SSE delivery is working');
    console.log('If not, there is a problem in the broadcast mechanism');
  } else {
    console.log('❌ ALERT ENGINE IS NOT WORKING');
    console.log('No new alerts are being created in database');
  }
}

testSSEIndirect().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});