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
    
    // Test search API endpoint
    console.log('Testing /api/search endpoint...');
    
    const searchOptions = {
      hostname: '127.0.0.1',
      port: 3001,
      path: '/api/search?q=test&limit=10',
      method: 'GET',
      headers: {
        'Cookie': `connect.sid=${sessionId}; csrf_token=${csrfToken}`,
        'x-csrf-token': csrfToken
      }
    };
    
    const searchReq = http.request(searchOptions, (searchRes) => {
      console.log(`Search Status: ${searchRes.statusCode}`);
      
      let data = '';
      searchRes.on('data', (chunk) => {
        data += chunk;
      });
      
      searchRes.on('end', () => {
        if (searchRes.statusCode === 200) {
          console.log('Search Response:', data);
          console.log('\n✅ Search API is working correctly!');
        } else {
          console.log('Search Error:', data);
          console.log('\n❌ Search API returned an error');
        }
      });
    });
    
    searchReq.on('error', (error) => {
      console.error('Search Error:', error.message);
      console.log('\n❌ Search API request failed');
    });
    
    searchReq.end();
  }
});

loginReq.on('error', (error) => {
  console.error('Login Error:', error.message);
});

loginReq.write(loginData);
loginReq.end();