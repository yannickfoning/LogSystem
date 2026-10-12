// Test des endpoints API Dashboard depuis le conteneur Docker
import http from 'http';

const BASE_URL = 'http://localhost:10000';

let sessionCookie = '';
let csrfToken = '';

// Fonction pour faire une requête HTTP
function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        // Capturer les cookies
        if (res.headers['set-cookie']) {
          res.headers['set-cookie'].forEach(cookie => {
            if (cookie.startsWith('connect.sid=')) {
              sessionCookie = cookie.split(';')[0];
            }
            if (cookie.startsWith('csrf_token=')) {
              csrfToken = cookie.split(';')[0];
            }
          });
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: body
        });
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(data);
    }

    req.end();
  });
}

async function testDashboard() {
  console.log('=== Test Dashboard API ===\n');

  // 1. Login
  console.log('1. Login admin...');
  try {
    const loginResponse = await makeRequest({
      hostname: 'localhost',
      port: 10000,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, JSON.stringify({
      email: 'admin@logsystem.local',
      password: 'Admin@1234'
    }));

    console.log(`   Status: ${loginResponse.statusCode}`);
    if (loginResponse.statusCode === 200) {
      console.log(`   Session: ${sessionCookie}`);
      console.log(`   CSRF: ${csrfToken}`);
    } else {
      console.log(`   Error: ${loginResponse.body}`);
      return;
    }
  } catch (error) {
    console.log(`   Error: ${error.message}`);
    return;
  }

  console.log('');

  // 2. Test /api/dashboard/summary
  console.log('2. Test /api/dashboard/summary...');
  try {
    const summaryResponse = await makeRequest({
      hostname: 'localhost',
      port: 10000,
      path: '/api/dashboard/summary',
      method: 'GET',
      headers: {
        'Cookie': `${sessionCookie}; ${csrfToken}`,
        'x-csrf-token': csrfToken.split('=')[1]
      }
    });

    console.log(`   Status: ${summaryResponse.statusCode}`);
    if (summaryResponse.statusCode === 200) {
      console.log(`   Response: ${summaryResponse.body.substring(0, 200)}...`);
    } else {
      console.log(`   Error: ${summaryResponse.body}`);
    }
  } catch (error) {
    console.log(`   Error: ${error.message}`);
  }

  console.log('');

  // 3. Test /api/dashboard/trends
  console.log('3. Test /api/dashboard/trends...');
  try {
    const trendsResponse = await makeRequest({
      hostname: 'localhost',
      port: 10000,
      path: '/api/dashboard/trends',
      method: 'GET',
      headers: {
        'Cookie': `${sessionCookie}; ${csrfToken}`,
        'x-csrf-token': csrfToken.split('=')[1]
      }
    });

    console.log(`   Status: ${trendsResponse.statusCode}`);
    if (trendsResponse.statusCode === 200) {
      console.log(`   Response: ${trendsResponse.body.substring(0, 200)}...`);
    } else {
      console.log(`   Error: ${trendsResponse.body}`);
    }
  } catch (error) {
    console.log(`   Error: ${error.message}`);
  }

  console.log('');

  // 4. Test /api/dashboard/per-level
  console.log('4. Test /api/dashboard/per-level...');
  try {
    const perLevelResponse = await makeRequest({
      hostname: 'localhost',
      port: 10000,
      path: '/api/dashboard/per-level',
      method: 'GET',
      headers: {
        'Cookie': `${sessionCookie}; ${csrfToken}`,
        'x-csrf-token': csrfToken.split('=')[1]
      }
    });

    console.log(`   Status: ${perLevelResponse.statusCode}`);
    if (perLevelResponse.statusCode === 200) {
      console.log(`   Response: ${perLevelResponse.body}`);
    } else {
      console.log(`   Error: ${perLevelResponse.body}`);
    }
  } catch (error) {
    console.log(`   Error: ${error.message}`);
  }

  console.log('');

  // 5. Test /api/logs/search
  console.log('5. Test /api/logs/search...');
  try {
    const searchResponse = await makeRequest({
      hostname: 'localhost',
      port: 10000,
      path: '/api/logs/search',
      method: 'GET',
      headers: {
        'Cookie': `${sessionCookie}; ${csrfToken}`,
        'x-csrf-token': csrfToken.split('=')[1]
      }
    });

    console.log(`   Status: ${searchResponse.statusCode}`);
    if (searchResponse.statusCode === 200) {
      const data = JSON.parse(searchResponse.body);
      console.log(`   Logs count: ${data.logs ? data.logs.length : 0}`);
    } else {
      console.log(`   Error: ${searchResponse.body}`);
    }
  } catch (error) {
    console.log(`   Error: ${error.message}`);
  }

  console.log('');
  console.log('=== Test terminé ===');
}

testDashboard();
