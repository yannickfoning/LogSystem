import http from 'http';
import mysql from 'mysql2/promise';
import crypto from 'crypto';

const SSE_TEST_TIMEOUT = 90000; // 90 seconds

async function testSSEWithRealConnection() {
  console.log('=== SSE TEST WITH REAL CONNECTION ===');
  console.log('Opening SSE connection and triggering alert creation...');
  console.log('');

  // Step 1: Open SSE connection without authentication first (to see if connection works)
  console.log('Step 1: Opening SSE connection...');
  const sseEvents = [];
  let sseConnected = false;

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
        // If authentication is required, try with login
        console.log('Authentication required, will try with login...');
        resolve({ needsAuth: true });
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
          resolve({ needsAuth: false });
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
    console.log('SSE requires authentication. Trying with login...');
    return testSSEWithAuth();
  }

  console.log('');

  // Step 2: Insert a CRITICAL log with user_id = 1
  console.log('Step 2: Inserting a CRITICAL log with user_id = 1...');
  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'log'
  });

  const testMessage = `REAL SSE TEST ${Date.now()} - ${crypto.randomBytes(8).toString('hex')}`;

  const [insertResult] = await conn.execute(
    `INSERT INTO logs (timestamp, log_level, message, source, service, user_id, imported_at, created_at)
     VALUES (NOW(), 'CRITICAL', ?, 'sse-real-test', 'test-service', 1, NOW(), NOW())`,
    [testMessage]
  );

  const logId = insertResult.insertId;
  console.log(`✅ Inserted CRITICAL log with ID: ${logId}, user_id: 1`);
  console.log(`Message: ${testMessage}`);
  console.log('');

  // Step 3: Wait for alert evaluation cycle
  console.log('Step 3: Waiting for alert evaluation cycle (60 seconds)...');
  console.log('Monitoring SSE events...');
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
  }

  console.log('');
  console.log('All SSE events received:');
  sseEvents.forEach((event, index) => {
    console.log(`${index + 1}. ${event.type} at ${new Date(event.timestamp).toISOString()}`);
    if (event.data) {
      console.log(`   Data: ${event.data.substring(0, 100)}...`);
    }
  });

  await conn.end();

  // Final conclusion
  console.log('');
  console.log('=== FINAL CONCLUSION ===');
  if (alertReceived) {
    console.log('✅ SSE DELIVERY WORKS CORRECTLY');
    console.log('Alerts are delivered via SSE when client is connected');
    console.log(`Insertion → SSE delivery time: ${alertTimestamp - startTime}ms`);
  } else {
    console.log('❌ SSE DELIVERY IS NOT WORKING');
    console.log('Even with a connected client, no alerts are delivered via SSE');
    console.log('This indicates a problem in the SSE broadcast mechanism');
  }
}

async function testSSEWithAuth() {
  console.log('=== SSE TEST WITH AUTHENTICATION ===');
  console.log('Testing SSE with authenticated connection...');
  console.log('');

  // Login first
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

        if (!sessionCookie) {
          reject(new Error('Missing session cookie'));
          return;
        }

        const sessionId = sessionCookie.split(';')[0].replace('connect.sid=', '');
        resolve({ sessionId });
      });
    });

    req.on('error', reject);
    req.write(loginData);
    req.end();
  });

  const { sessionId } = await loginPromise;
  console.log('✅ Login successful');
  console.log('');

  // Open SSE connection with authentication
  console.log('Step 2: Opening authenticated SSE connection...');
  const sseEvents = [];
  let sseConnected = false;

  const ssePromise = new Promise((resolve, reject) => {
    const sseReq = http.request({
      hostname: '127.0.0.1',
      port: 3001,
      path: '/api/alerts/stream',
      method: 'GET',
      headers: {
        'Cookie': `connect.sid=${sessionId}`,
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

  // Insert CRITICAL log and wait for alert
  console.log('Step 3: Inserting CRITICAL log and waiting for alert...');
  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'log'
  });

  const testMessage = `AUTH SSE TEST ${Date.now()} - ${crypto.randomBytes(8).toString('hex')}`;

  const [insertResult] = await conn.execute(
    `INSERT INTO logs (timestamp, log_level, message, source, service, user_id, imported_at, created_at)
     VALUES (NOW(), 'CRITICAL', ?, 'sse-auth-test', 'test-service', 1, NOW(), NOW())`,
    [testMessage]
  );

  console.log(`✅ Inserted CRITICAL log with ID: ${insertResult.insertId}`);
  console.log('');

  const startTime = Date.now();
  let alertReceived = false;

  const checkInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    console.log(`[${elapsed/1000}s] SSE events: ${sseEvents.length}`);

    const alertEvent = sseEvents.find(e => e.type === 'alert');
    if (alertEvent && !alertReceived) {
      alertReceived = true;
      console.log('🎯 ALERT RECEIVED via SSE!');
    }

    if (elapsed >= SSE_TEST_TIMEOUT) {
      clearInterval(checkInterval);
    }
  }, 5000);

  await new Promise(resolve => setTimeout(resolve, SSE_TEST_TIMEOUT));
  clearInterval(checkInterval);

  console.log('');
  console.log('=== RESULTS ===');
  console.log(`SSE events: ${sseEvents.length}`);
  console.log(`Alert received: ${alertReceived ? 'YES ✅' : 'NO ❌'}`);

  await conn.end();

  console.log('');
  console.log('=== CONCLUSION ===');
  if (alertReceived) {
    console.log('✅ SSE DELIVERY WORKS WITH AUTHENTICATION');
  } else {
    console.log('❌ SSE DELIVERY NOT WORKING EVEN WITH AUTH');
  }
}

testSSEWithRealConnection().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});