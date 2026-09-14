import { alertWorker } from './workers/alertWorker.js';
import mysql from 'mysql2/promise';
import crypto from 'crypto';

async function testSSEDirect() {
  console.log('=== DIRECT SSE BROADCAST TEST ===');
  console.log('Testing alertWorker.broadcastAlert() directly...');
  console.log('');

  // Create a mock SSE client
  const mockEvents = [];
  const mockResponse = {
    setHeader: () => {},
    flushHeaders: () => {},
    write: (data) => {
      console.log('[MOCK SSE] Received data:', data);
      mockEvents.push(data);
    },
    end: () => {}
  };

  const mockRequest = {
    session: { user: { id: 1, role: 'admin' } },
    headers: {},
    query: { min_severity: 'low' },
    on: (event, callback) => {
      if (event === 'close') {
        // Mock close event - won't be called in this test
      }
    }
  };

  // Add mock client
  console.log('Step 1: Adding mock SSE client...');
  const clientId = alertWorker.addClient(mockResponse, mockRequest);
  console.log(`✅ Mock client added with ID: ${clientId}`);
  console.log('');

  // Create a test alert
  console.log('Step 2: Creating test alert...');
  const testAlert = {
    id: 999,
    rule_id: 113,
    alert_type: 'level',
    severity: 'critical',
    message: `DIRECT SSE TEST ${Date.now()} - ${crypto.randomBytes(8).toString('hex')}`,
    status: 'new',
    user_id: 1,
    created_at: new Date().toISOString(),
    metadata: { test: true }
  };

  console.log(`Test alert: ${testAlert.message}`);
  console.log('');

  // Broadcast the alert
  console.log('Step 3: Broadcasting alert via alertWorker...');
  alertWorker.broadcastAlert(testAlert);
  console.log('✅ Alert broadcast completed');
  console.log('');

  // Check results
  console.log('Step 4: Checking results...');
  console.log(`Total mock events received: ${mockEvents.length}`);

  if (mockEvents.length > 0) {
    console.log('✅ SSE BROADCAST WORKS');
    console.log('Alert was successfully sent to mock client');
    console.log('');
    console.log('Events received:');
    mockEvents.forEach((event, index) => {
      console.log(`${index + 1}. ${event}`);
    });
  } else {
    console.log('❌ SSE BROADCAST NOT WORKING');
    console.log('No events were sent to mock client');
  }

  // Clean up
  alertWorker.removeClient(clientId);
  console.log('');
  console.log('Mock client removed');

  // Now test with real database insertion
  console.log('');
  console.log('=== TESTING WITH REAL DATABASE ALERT ===');
  console.log('Step 5: Inserting CRITICAL log to trigger real alert...');
  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'log'
  });

  const testMessage = `DIRECT DB TEST ${Date.now()} - ${crypto.randomBytes(8).toString('hex')}`;

  const [insertResult] = await conn.execute(
    `INSERT INTO logs (timestamp, log_level, message, source, service, user_id, imported_at, created_at)
     VALUES (NOW(), 'CRITICAL', ?, 'sse-direct-test', 'test-service', 1, NOW(), NOW())`,
    [testMessage]
  );

  console.log(`✅ Inserted CRITICAL log with ID: ${insertResult.insertId}`);
  console.log('');

  // Wait for alert evaluation
  console.log('Step 6: Waiting for alert evaluation (60 seconds)...');
  await new Promise(resolve => setTimeout(resolve, 65000));

  // Check for new alerts
  const [alerts] = await conn.execute(
    'SELECT * FROM alerts WHERE message LIKE ? ORDER BY created_at DESC LIMIT 1',
    [`%${testMessage}%`]
  );

  if (alerts.length > 0) {
    console.log('✅ Alert created in database');
    console.log(`Alert ID: ${alerts[0].id}`);
    console.log(`Alert message: ${alerts[0].message}`);

    // Test if this alert would be broadcast
    console.log('');
    console.log('Step 7: Testing broadcast of real alert...');
    const mockEvents2 = [];
    const mockResponse2 = {
      setHeader: () => {},
      flushHeaders: () => {},
      write: (data) => {
        console.log('[MOCK SSE 2] Received data:', data);
        mockEvents2.push(data);
      },
      end: () => {}
    };

    const clientId2 = alertWorker.addClient(mockResponse2, mockRequest);
    alertWorker.broadcastAlert(alerts[0]);
    alertWorker.removeClient(clientId2);

    if (mockEvents2.length > 0) {
      console.log('✅ Real alert broadcast works');
    } else {
      console.log('❌ Real alert broadcast failed');
    }
  } else {
    console.log('❌ No alert created in database');
  }

  await conn.end();

  console.log('');
  console.log('=== FINAL CONCLUSION ===');
  if (mockEvents.length > 0) {
    console.log('✅ alertWorker.broadcastAlert() WORKS CORRECTLY');
    console.log('The SSE broadcast mechanism is functional');
    console.log('');
    console.log('If alerts are not being delivered in production, the issue is:');
    console.log('1. alertWorker is not properly connected to alertEngine');
    console.log('2. No SSE clients are connected when alerts are created');
    console.log('3. Authentication/authorization is blocking SSE connections');
  } else {
    console.log('❌ alertWorker.broadcastAlert() IS NOT WORKING');
    console.log('There is a fundamental problem with the SSE broadcast mechanism');
  }
}

testSSEDirect().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});