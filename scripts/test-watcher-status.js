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
    
    // Test watcher status endpoint
    console.log('Testing /api/watchdogs/status endpoint...');
    
    const watcherOptions = {
      hostname: '127.0.0.1',
      port: 3001,
      path: '/api/watchdogs/status',
      method: 'GET',
      headers: {
        'Cookie': `connect.sid=${sessionId}; csrf_token=${csrfToken}`,
        'x-csrf-token': csrfToken
      }
    };
    
    const watcherReq = http.request(watcherOptions, (watcherRes) => {
      console.log(`Watcher Status: ${watcherRes.statusCode}`);
      
      let data = '';
      watcherRes.on('data', (chunk) => {
        data += chunk;
      });
      
      watcherRes.on('end', () => {
        if (watcherRes.statusCode === 200) {
          console.log('Watcher Response:', data);
          console.log('\n✅ Watcher API accessible');
        } else {
          console.log('Watcher Error:', data);
          console.log('\n❌ Watcher API non accessible');
        }
      });
    });
    
    watcherReq.on('error', (error) => {
      console.error('Watcher Error:', error.message);
      console.log('\n❌ Watcher API request failed');
    });
    
    watcherReq.end();
  }
});

loginReq.on('error', (error) => {
  console.error('Login Error:', error.message);
});

loginReq.write(loginData);
loginReq.end();