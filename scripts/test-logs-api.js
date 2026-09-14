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
    
    // Test logs API endpoint
    console.log('Testing /api/logs endpoint...');
    
    const logsOptions = {
      hostname: '127.0.0.1',
      port: 3001,
      path: '/api/logs?limit=10',
      method: 'GET',
      headers: {
        'Cookie': `connect.sid=${sessionId}; csrf_token=${csrfToken}`,
        'x-csrf-token': csrfToken
      }
    };
    
    const logsReq = http.request(logsOptions, (logsRes) => {
      console.log(`Logs Status: ${logsRes.statusCode}`);
      
      let data = '';
      logsRes.on('data', (chunk) => {
        data += chunk;
      });
      
      logsRes.on('end', () => {
        if (logsRes.statusCode === 200) {
          console.log('Logs Response:', data);
          console.log('\n✅ Logs API is working correctly!');
        } else {
          console.log('Logs Error:', data);
          console.log('\n❌ Logs API returned an error');
        }
      });
    });
    
    logsReq.on('error', (error) => {
      console.error('Logs Error:', error.message);
      console.log('\n❌ Logs API request failed');
    });
    
    logsReq.end();
  }
});

loginReq.on('error', (error) => {
  console.error('Login Error:', error.message);
});

loginReq.write(loginData);
loginReq.end();