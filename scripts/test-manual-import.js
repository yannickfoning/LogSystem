import http from 'http';
import fs from 'fs';
import path from 'path';

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
    
    // Test manual import via API
    console.log('Testing manual log import via API...');
    
    const logFilePath = path.join(process.cwd(), 'logs', 'test-app.log');
    console.log('File path:', logFilePath);
    
    if (!fs.existsSync(logFilePath)) {
      console.log('❌ Test file does not exist');
      return;
    }
    
    const fileContent = fs.readFileSync(logFilePath, 'utf8');
    console.log('File content preview:', fileContent.substring(0, 100));
    
    // Create form data for file upload
    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
    const formData = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="test-app.log"',
      'Content-Type: text/plain',
      '',
      fileContent,
      `--${boundary}--`
    ].join('\r\n');
    
    const importOptions = {
      hostname: '127.0.0.1',
      port: 3001,
      path: '/api/import/upload',
      method: 'POST',
      headers: {
        'Cookie': `connect.sid=${sessionId}; csrf_token=${csrfToken}`,
        'x-csrf-token': csrfToken,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': Buffer.byteLength(formData)
      }
    };
    
    const importReq = http.request(importOptions, (importRes) => {
      console.log(`Import Status: ${importRes.statusCode}`);
      
      let data = '';
      importRes.on('data', (chunk) => {
        data += chunk;
      });
      
      importRes.on('end', () => {
        if (importRes.statusCode === 200) {
          console.log('Import Response:', data);
          console.log('\n✅ Manual import successful');
        } else {
          console.log('Import Error:', data);
          console.log('\n❌ Manual import failed');
        }
      });
    });
    
    importReq.on('error', (error) => {
      console.error('Import Error:', error.message);
      console.log('\n❌ Import request failed');
    });
    
    importReq.write(formData);
    importReq.end();
  }
});

loginReq.on('error', (error) => {
  console.error('Login Error:', error.message);
});

loginReq.write(loginData);
loginReq.end();