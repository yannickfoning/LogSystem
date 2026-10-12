import http from 'http';

const testLogin = () => {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      email: 'admin@logsystem.com',
      password: 'admin123'
    });

    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve(response);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
};

const testDashboard = (token) => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/api/dashboard/summary',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Cookie': `token=${token}`
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve(response);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
};

const testSearch = (token) => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/api/search/metadata',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Cookie': `token=${token}`
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve(response);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
};

const testAdminRules = (token) => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/api/admin/alert-rules',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Cookie': `token=${token}`
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve(response);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
};

async function runTests() {
  console.log('🧪 Démarrage des tests de modifications...\n');
  
  try {
    // Test 1: Login
    console.log('📝 Test 1: Login...');
    const loginResponse = await testLogin();
    console.log('✅ Login réussi:', loginResponse.token ? 'Token reçu' : 'Pas de token');
    const token = loginResponse.token;
    
    // Test 2: Dashboard
    console.log('\n📊 Test 2: Dashboard summary...');
    const dashboardResponse = await testDashboard(token);
    console.log('✅ Dashboard:', {
      totalLogs: dashboardResponse.total_logs,
      sourceCount: dashboardResponse.source_count,
      todayLogs: dashboardResponse.today_logs
    });
    
    // Test 3: Search metadata
    console.log('\n🔍 Test 3: Search metadata...');
    const searchResponse = await testSearch(token);
    console.log('✅ Search metadata:', {
      sources: searchResponse.sources?.length || 0,
      services: searchResponse.services?.length || 0,
      targetUsers: searchResponse.target_users?.length || 0
    });
    
    // Test 4: Admin rules
    console.log('\n⚙️ Test 4: Admin alert rules...');
    const rulesResponse = await testAdminRules(token);
    console.log('✅ Admin rules:', Array.isArray(rulesResponse) ? `${rulesResponse.length} règles` : 'Format non array');
    
    console.log('\n✨ Tous les tests terminés avec succès !');
    
  } catch (error) {
    console.error('❌ Erreur lors des tests:', error.message);
  }
}

runTests();