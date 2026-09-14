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
    
    // Test admin API endpoint
    console.log('Testing /api/admin/users endpoint...');
    
    const adminOptions = {
      hostname: '127.0.0.1',
      port: 3001,
      path: '/api/admin/users',
      method: 'GET',
      headers: {
        'Cookie': `connect.sid=${sessionId}; csrf_token=${csrfToken}`,
        'x-csrf-token': csrfToken
      }
    };
    
    const adminReq = http.request(adminOptions, (adminRes) => {
      console.log(`Admin Status: ${adminRes.statusCode}`);
      
      let data = '';
      adminRes.on('data', (chunk) => {
        data += chunk;
      });
      
      adminRes.on('end', () => {
        if (adminRes.statusCode === 200) {
          console.log('Admin Response:', data);
          console.log('\n✅ Admin API is working correctly!');
        } else {
          console.log('Admin Error:', data);
          console.log('\n❌ Admin API returned an error');
        }
      });
    });
    
    adminReq.on('error', (error) => {
      console.error('Admin Error:', error.message);
      console.log('\n❌ Admin API request failed');
    });
    
    adminReq.end();
  }
});

loginReq.on('error', (error) => {
  console.error('Login Error:', error.message);
});

loginReq.write(loginData);
loginReq.end();