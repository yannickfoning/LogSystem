import http from 'http';

// First login to get session
const loginOptions = {
  hostname: '127.0.0.1',
  port: 3001,
  path: '/api/auth/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  }
};

const loginData = JSON.stringify({
  email: 'admin@logsystem.local',
  password: 'Admin@1234'
});

const loginReq = http.request(loginOptions, (loginRes) => {
  console.log(`Login Status: ${loginRes.statusCode}`);
  
  const cookies = loginRes.headers['set-cookie'] || [];
  const sessionCookie = cookies.find(c => c.startsWith('connect.sid='));
  const csrfCookie = cookies.find(c => c.startsWith('csrf_token='));
  
  if (sessionCookie && csrfCookie) {
    const sessionId = sessionCookie.split(';')[0].replace('connect.sid=', '');
    const csrfToken = csrfCookie.split(';')[0].replace('csrf_token=', '');
    
    // Test dashboard endpoint
    console.log('Testing /api/dashboard/summary endpoint...');
    
    const dashboardOptions = {
      hostname: '127.0.0.1',
      port: 3001,
      path: '/api/dashboard/summary',
      method: 'GET',
      headers: {
        'Cookie': `connect.sid=${sessionId}; csrf_token=${csrfToken}`,
        'x-csrf-token': csrfToken
      }
    };
    
    const dashboardReq = http.request(dashboardOptions, (dashboardRes) => {
      console.log(`Dashboard Status: ${dashboardRes.statusCode}`);
      
      let data = '';
      dashboardRes.on('data', (chunk) => {
        data += chunk;
      });
      
      dashboardRes.on('end', () => {
        if (dashboardRes.statusCode === 200) {
          console.log('Dashboard Response:', data);
          console.log('\n✅ Dashboard API is working correctly!');
        } else {
          console.log('Dashboard Error:', data);
          console.log('\n❌ Dashboard API returned an error');
        }
      });
    });
    
    dashboardReq.on('error', (error) => {
      console.error('Dashboard Error:', error.message);
      console.log('\n❌ Dashboard API request failed');
    });
    
    dashboardReq.end();
  }
});

loginReq.on('error', (error) => {
  console.error('Login Error:', error.message);
});

loginReq.write(loginData);
loginReq.end();