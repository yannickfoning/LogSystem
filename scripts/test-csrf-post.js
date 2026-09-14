import http from 'http';

// Test CSRF protection by making a POST request without CSRF token
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
  
  if (sessionCookie) {
    const sessionId = sessionCookie.split(';')[0].replace('connect.sid=', '');
    
    // Test CSRF protection by making POST request without CSRF token
    console.log('Testing CSRF protection (POST request without CSRF token)...');
    
    const csrfTestOptions = {
      hostname: '127.0.0.1',
      port: 3001,
      path: '/api/dashboard/alerts/read-all',
      method: 'POST',
      headers: {
        'Cookie': `connect.sid=${sessionId}`,
        'Content-Type': 'application/json',
        // Note: Missing x-csrf-token header
      }
    };
    
    const csrfTestReq = http.request(csrfTestOptions, (csrfTestRes) => {
      console.log(`CSRF Test Status: ${csrfTestRes.statusCode}`);
      
      let data = '';
      csrfTestRes.on('data', (chunk) => {
        data += chunk;
      });
      
      csrfTestRes.on('end', () => {
        if (csrfTestRes.statusCode === 403) {
          console.log('CSRF Response:', data);
          console.log('\n✅ CSRF protection is working correctly!');
        } else {
          console.log('CSRF Response:', data);
          console.log('\n⚠️ CSRF protection may not be properly configured for POST requests');
        }
      });
    });
    
    csrfTestReq.on('error', (error) => {
      console.error('CSRF Test Error:', error.message);
      console.log('\n❌ CSRF test request failed');
    });
    
    csrfTestReq.end();
  }
});

loginReq.on('error', (error) => {
  console.error('Login Error:', error.message);
});

loginReq.write(loginData);
loginReq.end();