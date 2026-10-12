import http from 'http';
import mysql from 'mysql2/promise';
import crypto from 'crypto';

const SSE_TEST_TIMEOUT = 120000; // 2 minutes max wait
const ALERT_EVAL_INTERVAL = 60000; // 60 seconds from config

async function testSSEDelivery() {
  console.log('=== SSE DELIVERY TEST ===');
  console.log('Starting comprehensive SSE delivery test...');
  console.log('');

  // Step 1: Login to get session
  console.log('Step 1: Logging in as admin...');
  const loginData = JSON.stringify({
    email: 'admin@logsystem.local',
    password: 'Admin@1234'
  });

  const loginPromise = new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3001,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': loginData.length
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Login failed: ${res.statusCode} - ${body}`));
          return;
        }

        const cookies = res.headers['set-cookie'] || [];
        const sessionCookie = cookies.find(c => c.startsWith('connect.sid='));
        const csrfCookie = cookies.find(c => c.startsWith('csrf_token='));

        if (!sessionCookie || !csrfCookie) {
          reject(new Error('Missing session or CSRF cookie'));
          return;
        }

        const sessionId = sessionCookie.split(';')[0].replace('connect.sid=', '');
        const csrfToken = csrfCookie.split(';')[0].replace('csrf_token=', '');

        resolve({ sessionId, csrfToken });
      });
    });

    req.on('error', reject);
    req.write(loginData);
    req.end();
  });

  const { sessionId, csrfToken } = await loginPromise;
  console.log('✅ Login successful');
  console.log('');

  // Step 2: Open SSE connection
  console.log('Step 2: Opening SSE connection...');
  const sseEvents = [];
  let sseConnected = false;

  const ssePromise = new Promise((resolve, reject) => {
    const sseReq = http.request({
      hostname: '127.0.0.1',
      port: 3001,
      path: '/api/alerts/stream',
      method: 'GET',
      headers: {
        'Cookie': `connect.sid=${sessionId}; csrf_token=${csrfToken}`,
        'Accept': 'text/event-stream'
      }
    }, (res) => {
      console.log(`SSE connection status: ${res.statusCode}`);
      if (res.statusCode !== 200) {
        reject(new Error(`SSE connection failed: ${res.statusCode}`));
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
            sseEvents.push({ type: eventType, data: null, timestamp: Date.now() });
            console.log(`[SSE] Event type: ${eventType}`);
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
          resolve();
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

  await ssePromise;
  console.log('');

  // Step 3: Check existing alert rules
  console.log('Step 3: Checking existing alert rules...');
  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'log'
  });

  const [rules] = await conn.execute(
    'SELECT id, name, condition_type, condition_value, threshold_value, time_window_minutes FROM alert_rules WHERE is_active = 1 LIMIT 5'
  );

  console.log(`Found ${rules.length} active alert rules:`);
  for (const rule of rules) {
    console.log(`  - Rule ${rule.id}: ${rule.name} (${rule.condition_type}=${rule.condition_value}, threshold=${rule.threshold_value})`);
  }
  console.log('');

  // Step 4: Insert a log that will trigger an alert
  console.log('Step 4: Inserting a CRITICAL log to trigger immediate alert...');
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

  // Step 5: Wait for alert evaluation cycle
  console.log(`Step 5: Waiting for alert evaluation cycle (${ALERT_EVAL_INTERVAL}ms)...`);
  console.log('Monitoring SSE events for 2 minutes...');

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
      console.log(`Time from log insertion: ${alertTimestamp - startTime}ms`);
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
  console.log(`Total SSE events received: ${sseEvents.length}`);
  console.log(`Alert received: ${alertReceived ? 'YES ✅' : 'NO ❌'}`);

  if (alertReceived) {
    console.log(`Time to receive alert: ${alertTimestamp - startTime}ms`);
    console.log(`Alert event details:`, sseEvents.find(e => e.type === 'alert'));
  } else {
    console.log('⚠️ No alert received via SSE within timeout period');
    console.log('This indicates the SSE delivery is NOT working correctly');
  }

  console.log('');
  console.log('All SSE events received:');
  sseEvents.forEach((event, index) => {
    console.log(`${index + 1}. ${event.type} at ${new Date(event.timestamp).toISOString()}`);
    if (event.data) {
      console.log(`   Data: ${event.data.substring(0, 100)}...`);
    }
  });

  // Step 6: Check if alert was created in database
  console.log('');
  console.log('Step 6: Checking if alert was created in database...');
  const [alerts] = await conn.execute(
    'SELECT * FROM alerts WHERE message LIKE ? ORDER BY created_at DESC LIMIT 1',
    [`%${testMessage}%`]
  );

  if (alerts.length > 0) {
    console.log('✅ Alert was created in database');
    console.log(`Alert ID: ${alerts[0].id}`);
    console.log(`Alert created at: ${alerts[0].created_at}`);
  } else {
    console.log('❌ No alert found in database');
  }

  await conn.end();

  // Final conclusion
  console.log('');
  console.log('=== FINAL CONCLUSION ===');
  if (alertReceived && alerts.length > 0) {
    console.log('✅ SSE DELIVERY WORKS CORRECTLY');
    console.log('Alerts are both created in database AND delivered via SSE');
  } else if (alerts.length > 0 && !alertReceived) {
    console.log('❌ SSE DELIVERY IS BROKEN');
    console.log('Alerts are created in database but NOT delivered via SSE');
    console.log('This indicates a problem in alertWorker.js or the SSE broadcast mechanism');
  } else if (!alerts.length > 0 && !alertReceived) {
    console.log('❌ ALERT ENGINE IS NOT WORKING');
    console.log('No alerts are created in database, so SSE cannot deliver them');
    console.log('This indicates a problem in alertEngine.js evaluation logic');
  } else {
    console.log('⚠️ UNEXPECTED STATE');
    console.log('Alert received via SSE but not found in database (should not happen)');
  }
}

testSSEDelivery().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});