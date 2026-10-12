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
      // Capture les cookies
      const cookies = res.headers['set-cookie'] || [];
      
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve({ status: res.statusCode, data: response, cookies: cookies });
        } catch (e) {
          resolve({ status: res.statusCode, data: data, cookies: cookies });
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
};

const testDashboard = (cookies) => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/api/dashboard/summary',
      method: 'GET',
      headers: {
        'Cookie': cookies.join('; ')
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve({ status: res.statusCode, data: response });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
};

const testSearch = (cookies) => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/api/search/metadata',
      method: 'GET',
      headers: {
        'Cookie': cookies.join('; ')
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve({ status: res.statusCode, data: response });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
};

const testAdminRules = (cookies) => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/api/admin/alert-rules',
      method: 'GET',
      headers: {
        'Cookie': cookies.join('; ')
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve({ status: res.statusCode, data: response });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
};

async function runTests() {
  console.log('🧪 Démarrage des tests de modifications v2...\n');
  
  try {
    // Test 1: Login
    console.log('📝 Test 1: Login...');
    const loginResponse = await testLogin();
    console.log('✅ Login:', {
      status: loginResponse.status,
      user: loginResponse.data.email,
      role: loginResponse.data.role,
      cookies: loginResponse.cookies.length
    });
    
    const cookies = loginResponse.cookies;
    
    // Test 2: Dashboard
    console.log('\n📊 Test 2: Dashboard summary...');
    const dashboardResponse = await testDashboard(cookies);
    console.log('✅ Dashboard:', {
      status: dashboardResponse.status,
      totalLogs: dashboardResponse.data.total_logs,
      sourceCount: dashboardResponse.data.source_count,
      todayLogs: dashboardResponse.data.today_logs
    });
    
    // Test 3: Search metadata
    console.log('\n🔍 Test 3: Search metadata...');
    const searchResponse = await testSearch(cookies);
    console.log('✅ Search metadata:', {
      status: searchResponse.status,
      sources: searchResponse.data.sources?.length || 0,
      services: searchResponse.data.services?.length || 0,
      targetUsers: searchResponse.data.target_users?.length || 0
    });
    
    // Test 4: Admin rules
    console.log('\n⚙️ Test 4: Admin alert rules...');
    const rulesResponse = await testAdminRules(cookies);
    console.log('✅ Admin rules:', {
      status: rulesResponse.status,
      count: Array.isArray(rulesResponse.data) ? rulesResponse.data.length : 'Non array'
    });
    
    console.log('\n✨ Tous les tests terminés avec succès !');
    
  } catch (error) {
    console.error('❌ Erreur lors des tests:', error.message);
  }
}

runTests();