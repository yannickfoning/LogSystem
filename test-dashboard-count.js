import http from 'http';
import mysql from 'mysql2/promise';

async function testDashboardCount() {
  console.log('=== DASHBOARD COUNT VERIFICATION ===');
  console.log('');

  // Step 1: Check database counts
  console.log('Step 1: Database counts...');
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

  // Step 2: Test API response without auth first
  console.log('Step 2: Testing API /api/dashboard/per-level without auth...');
  const apiPromise = new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3001,
      path: '/api/dashboard/per-level',
      method: 'GET'
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
          resolve({ status: res.statusCode, data: null, apiTotal: 0, needsAuth: true });
        }
      });
    });

    req.on('error', reject);
    req.end();
  });

  const apiResult = await apiPromise;

  if (apiResult.needsAuth) {
    console.log('API requires authentication');
  }

  await conn.end();

  // Final comparison
  console.log('');
  console.log('=== COMPARISON ===');
  console.log('Database total (COUNT(*)):', total[0].total);
  console.log('API total (if accessible):', apiResult.apiTotal || 'N/A (requires auth)');

  if (apiResult.apiTotal !== null) {
    if (apiResult.apiTotal === total[0].total) {
      console.log('✅ API matches database count');
    } else {
      console.log('❌ API does NOT match database count');
      console.log('Difference:', apiResult.apiTotal - total[0].total);
    }
  }

  console.log('');
  console.log('=== ANALYSIS ===');
  console.log('Logs with user_id:', withUser[0].total);
  console.log('Logs without user_id:', withoutUser[0].total);
  console.log('');
  console.log('If API requires authentication and filters by user_id,');
  console.log('this could explain any discrepancy between DB and API counts.');
}

testDashboardCount().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});