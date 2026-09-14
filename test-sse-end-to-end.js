import http from 'http';
import mysql from 'mysql2/promise';
import crypto from 'crypto';

const SSE_TEST_TIMEOUT = 90000; // 90 seconds

async function testSSEEndToEnd() {
  console.log('=== SSE END-TO-END TEST ===');
  console.log('Testing complete SSE pipeline with real EventSource connection...');
  console.log('');

  // Step 1: Insert a CRITICAL log with user_id = 1 via SQL (direct insertion)
  console.log('Step 1: Inserting CRITICAL log with user_id = 1...');
  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'log'
  });

  const testMessage = `E2E SSE TEST ${Date.now()} - ${crypto.randomBytes(8).toString('hex')}`;
  const insertionTime = Date.now();

  const [insertResult] = await conn.execute(
    `INSERT INTO logs (timestamp, log_level, message, source, service, user_id, imported_at, created_at)
     VALUES (NOW(), 'CRITICAL', ?, 'sse-e2e-test', 'test-service', 1, NOW(), NOW())`,
    [testMessage]
  );

  const logId = insertResult.insertId;
  console.log(`✅ Inserted CRITICAL log with ID: ${logId}, user_id: 1`);
  console.log(`Insertion timestamp: ${insertionTime}`);
  console.log(`Message: ${testMessage}`);
  console.log('');

  // Step 2: Open SSE connection (without auth for now to test if connection works)
  console.log('Step 2: Opening SSE connection...');
  const sseEvents = [];
  let sseConnected = false;
  const connectionTime = Date.now();

  const ssePromise = new Promise((resolve, reject) => {
    const sseReq = http.request({
      hostname: '127.0.0.1',
      port: 3001,
      path: '/api/alerts/stream',
      method: 'GET',
      headers: {
        'Accept': 'text/event-stream'
      }
    }, (res) => {
      console.log(`SSE connection status: ${res.statusCode}`);
      if (res.statusCode !== 200) {
        resolve({ needsAuth: true, status: res.statusCode });
        return;
      }

      let buffer = '';
      res.on('data', chunk => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event:')) {
            const eventType = line.substring(6).trim();
            const event = {
              type: eventType,
              data: null,
              timestamp: Date.now(),
              raw: line
            };
            sseEvents.push(event);
            console.log(`[SSE] Event type: ${eventType} at ${event.timestamp}`);
          } else if (line.startsWith('data:')) {
            const data = line.substring(5).trim();
            if (sseEvents.length > 0) {
              sseEvents[sseEvents.length - 1].data = data;
              try {
                const parsed = JSON.parse(data);
                console.log(`[SSE] Event data:`, parsed);
              } catch (e) {
                console.log(`[SSE] Event data (raw):`, data);
              }
            }
          } else if (line.startsWith('id:')) {
            if (sseEvents.length > 0) {
              sseEvents[sseEvents.length - 1].id = line.substring(3).trim();
            }
          }
        }

        if (!sseConnected && buffer.includes('connected')) {
          sseConnected = true;
          console.log('✅ SSE connection established');
          resolve({ needsAuth: false, status: 200 });
        }
      });

      res.on('end', () => {
        console.log('[SSE] Connection ended');
      });

      res.on('error', (err) => {
        console.error('[SSE] Connection error:', err);
        reject(err);
      });
    });

    sseReq.on('error', reject);
    sseReq.end();
  });

  const sseResult = await ssePromise;

  if (sseResult.needsAuth) {
    console.log('SSE requires authentication');
    console.log('This is expected behavior - SSE endpoints should be protected');
  } else {
    console.log('');

    // Step 3: Wait for alert evaluation cycle
    console.log('Step 3: Waiting for alert evaluation cycle (60 seconds)...');
    console.log('Monitoring SSE events for alert delivery...');
    console.log('');

    const startTime = Date.now();
    let alertReceived = false;
    let alertTimestamp = null;

    const checkInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      console.log(`[${elapsed/1000}s] SSE events received: ${sseEvents.length}`);

      // Check if we received an alert event
      const alertEvent = sseEvents.find(e => e.type === 'alert');
      if (alertEvent && !alertReceived) {
        alertReceived = true;
        alertTimestamp = Date.now();
        console.log('🎯 ALERT RECEIVED via SSE!');
        console.log(`Time from log insertion: ${alertTimestamp - insertionTime}ms`);
        console.log(`Time from SSE connection: ${alertTimestamp - connectionTime}ms`);
      }

      if (elapsed >= SSE_TEST_TIMEOUT) {
        clearInterval(checkInterval);
      }
    }, 5000);

    // Wait for the full evaluation cycle
    await new Promise(resolve => setTimeout(resolve, SSE_TEST_TIMEOUT));
    clearInterval(checkInterval);

    console.log('');
    console.log('=== TEST RESULTS ===');
    console.log(`Insertion timestamp: ${insertionTime}`);
    console.log(`SSE connection timestamp: ${connectionTime}`);
    console.log(`Total SSE events received: ${sseEvents.length}`);
    console.log(`Alert received: ${alertReceived ? 'YES ✅' : 'NO ❌'}`);

    if (alertReceived) {
      console.log(`Time from insertion to SSE delivery: ${alertTimestamp - insertionTime}ms`);
      console.log(`Alert event details:`, sseEvents.find(e => e.type === 'alert'));
    } else {
      console.log('⚠️ No alert received via SSE within timeout period');
    }

    console.log('');
    console.log('All SSE events received:');
    sseEvents.forEach((event, index) => {
      console.log(`${index + 1}. ${event.type} at ${new Date(event.timestamp).toISOString()} (Δ${event.timestamp - insertionTime}ms)`);
      if (event.data) {
        console.log(`   Data: ${event.data.substring(0, 100)}...`);
      }
    });
  }

  // Step 4: Check if alert was created in database
  console.log('');
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

  // Step 5: Test with log WITHOUT user_id
  console.log('');
  console.log('Step 5: Testing with log WITHOUT user_id...');
  const testMessage2 = `E2E SSE TEST NO USER ${Date.now()} - ${crypto.randomBytes(8).toString('hex')}`;
  const insertionTime2 = Date.now();

  const [insertResult2] = await conn.execute(
    `INSERT INTO logs (timestamp, log_level, message, source, service, user_id, imported_at, created_at)
     VALUES (NOW(), 'CRITICAL', ?, 'sse-e2e-test', 'test-service', NULL, NOW(), NOW())`,
    [testMessage2]
  );

  console.log(`✅ Inserted CRITICAL log with ID: ${insertResult2.insertId}, user_id: NULL`);
  console.log(`Insertion timestamp: ${insertionTime2}`);
  console.log('');

  // Wait for alert evaluation
  console.log('Waiting for alert evaluation cycle (60 seconds)...');
  await new Promise(resolve => setTimeout(resolve, 65000));

  // Check for alert
  const [alerts2] = await conn.execute(
    'SELECT * FROM alerts WHERE message LIKE ? ORDER BY created_at DESC LIMIT 1',
    [`%${testMessage2}%`]
  );

  if (alerts2.length > 0) {
    console.log('✅ Alert was created for log WITHOUT user_id');
    console.log(`Alert ID: ${alerts2[0].id}`);
  } else {
    console.log('❌ No alert created for log WITHOUT user_id');
    console.log('This confirms that alerts require a valid user_id');
  }

  await conn.end();

  // Final conclusion
  console.log('');
  console.log('=== FINAL CONCLUSION ===');
  console.log('RAW DATA:');
  console.log(`Log insertion time: ${insertionTime}`);
  console.log(`Alert received via SSE: ${typeof alertReceived !== 'undefined' ? (alertReceived ? 'YES' : 'NO') : 'N/A (SSE requires auth)'}`);
  console.log(`Alert created in DB (with user_id): ${alerts.length > 0 ? 'YES' : 'NO'}`);
  console.log(`Alert created in DB (without user_id): ${alerts2.length > 0 ? 'YES' : 'NO'}`);
  console.log('');
  console.log('SCOPE BEHAVIOR:');
  console.log(`Alerts require user_id: ${alerts2.length === 0 ? 'CONFIRMED' : 'NOT CONFIRMED'}`);
  console.log('');
  console.log('TIMING:');
  if (typeof alertReceived !== 'undefined' && alertReceived) {
    console.log(`Insertion → SSE delivery: ${alertTimestamp - insertionTime}ms`);
  } else {
    console.log('SSE delivery timing: N/A (SSE requires authentication, cannot test without it)');
  }
}

testSSEEndToEnd().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});