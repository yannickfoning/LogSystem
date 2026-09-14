import http from 'http';
import mysql from 'mysql2/promise';

async function testDashboardWithAuth() {
  console.log('=== DASHBOARD COUNT WITH AUTH ===');
  console.log('');

  // Step 1: Login as admin
  console.log('Step 1: Login as admin...');
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
        console.log(`Login Status: ${res.statusCode}`);
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

  // Step 2: Check database counts
  console.log('Step 2: Database counts...');
  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'log'
  });

  const [total] = await conn.execute('SELECT COUNT(*) as total FROM logs');
  const [withUser] = await conn.execute('SELECT COUNT(*) as total FROM logs WHERE user_id IS NOT NULL');
  const [withoutUser] = await conn.execute('SELECT COUNT(*) as total FROM logs WHERE user_id IS NULL');

  console.log('COUNT(*) FROM logs (total):', total[0].total);
  console.log('COUNT(*) FROM logs WHERE user_id IS NOT NULL:', withUser[0].total);
  console.log('COUNT(*) FROM logs WHERE user_id IS NULL:', withoutUser[0].total);
  console.log('');

  // Step 3: Test API with auth
  console.log('Step 3: Testing API /api/dashboard/per-level with admin auth...');
  const apiPromise = new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3001,
      path: '/api/dashboard/per-level',
      method: 'GET',
      headers: {
        'Cookie': `connect.sid=${sessionId}`
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        console.log(`API Status: ${res.statusCode}`);
        if (res.statusCode === 200) {
          try {
            const data = JSON.parse(body);
            const apiTotal = Object.values(data).reduce((a, b) => a + b, 0);
            console.log('API Response:', body);
            console.log('API Total:', apiTotal);
            resolve({ status: res.statusCode, data, apiTotal });
          } catch (e) {
            console.log('API Response (raw):', body);
            resolve({ status: res.statusCode, data: null, apiTotal: 0 });
          }
        } else {
          console.log('API Response:', body);
          resolve({ status: res.statusCode, data: null, apiTotal: 0 });
        }
      });
    });

    req.on('error', reject);
    req.end();
  });

  const apiResult = await apiPromise;
  await conn.end();

  // Final comparison
  console.log('');
  console.log('=== COMPARISON ===');
  console.log('Database total (COUNT(*)):', total[0].total);
  console.log('API total (admin auth):', apiResult.apiTotal);

  if (apiResult.apiTotal === total[0].total) {
    console.log('✅ API matches database count');
  } else {
    console.log('❌ API does NOT match database count');
    console.log('Difference:', apiResult.apiTotal - total[0].total);
    console.log('');
    console.log('This indicates a filtering issue in the API');
  }

  console.log('');
  console.log('=== ANALYSIS ===');
  console.log('All logs in database have user_id = NULL:', withoutUser[0].total === total[0].total);
  console.log('Admin user should see all logs regardless of user_id');
  console.log('');
  if (apiResult.apiTotal !== total[0].total) {
    console.log('BUG IDENTIFIED: API is filtering out logs with user_id = NULL');
    console.log('This could be in the userScope middleware or the SQL query');
  }
}

testDashboardWithAuth().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});