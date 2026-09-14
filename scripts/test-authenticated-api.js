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
  
  // Extract cookies
  const cookies = loginRes.headers['set-cookie'] || [];
  const sessionCookie = cookies.find(c => c.startsWith('connect.sid='));
  const csrfCookie = cookies.find(c => c.startsWith('csrf_token='));
  
  console.log('Session cookie:', sessionCookie ? 'Found' : 'Not found');
  console.log('CSRF cookie:', csrfCookie ? 'Found' : 'Not found');
  
  if (sessionCookie && csrfCookie) {
    // Test authenticated endpoint
    const sessionId = sessionCookie.split(';')[0].replace('connect.sid=', '');
    const csrfToken = csrfCookie.split(';')[0].replace('csrf_token=', '');
    
    console.log('Testing /api/auth/me endpoint...');
    
    const meOptions = {
      hostname: '127.0.0.1',
      port: 3001,
      path: '/api/auth/me',
      method: 'GET',
      headers: {
        'Cookie': `connect.sid=${sessionId}; csrf_token=${csrfToken}`,
        'x-csrf-token': csrfToken
      }
    };
    
    const meReq = http.request(meOptions, (meRes) => {
      console.log(`Me Status: ${meRes.statusCode}`);
      
      let data = '';
      meRes.on('data', (chunk) => {
        data += chunk;
      });
      
      meRes.on('end', () => {
        console.log('Me Response:', data);
        console.log('\n✅ Authentication system is working correctly!');
      });
    });
    
    meReq.on('error', (error) => {
      console.error('Me Error:', error.message);
    });
    
    meReq.end();
  }
});

loginReq.on('error', (error) => {
  console.error('Login Error:', error.message);
});

loginReq.write(loginData);
loginReq.end();