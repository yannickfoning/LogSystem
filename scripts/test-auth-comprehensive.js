import http from 'http';

// Test 1: Login with admin credentials
console.log('=== TEST 1: Login Admin ===');
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
  console.log(`Status: ${loginRes.statusCode}`);
  
  const cookies = loginRes.headers['set-cookie'] || [];
  const sessionCookie = cookies.find(c => c.startsWith('connect.sid='));
  const csrfCookie = cookies.find(c => c.startsWith('csrf_token='));
  
  if (loginRes.statusCode === 200 && sessionCookie && csrfCookie) {
    console.log('✅ Login admin réussi');
    console.log('✅ Session cookie généré');
    console.log('✅ CSRF cookie généré');
    
    const sessionId = sessionCookie.split(';')[0].replace('connect.sid=', '');
    const csrfToken = csrfCookie.split(';')[0].replace('csrf_token=', '');
    
    // Test 2: Session persistence
    console.log('\n=== TEST 2: Session Persistence ===');
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
      let data = '';
      meRes.on('data', (chunk) => { data += chunk; });
      meRes.on('end', () => {
        if (meRes.statusCode === 200) {
          console.log('✅ Session persiste entre requêtes');
          console.log('Response:', data);
        } else {
          console.log('❌ Session non persistante');
        }
        
        // Test 3: Protected page redirect
        console.log('\n=== TEST 3: Protected Page Redirect ===');
        const protectedOptions = {
          hostname: '127.0.0.1',
          port: 3001,
          path: '/dashboard.html',
          method: 'GET',
          headers: {}
        };
        
        const protectedReq = http.request(protectedOptions, (protectedRes) => {
          console.log(`Status: ${protectedRes.statusCode}`);
          if (protectedRes.statusCode === 302) {
            console.log('✅ Redirection vers login (non connecté)');
          } else {
            console.log('⚠️ Pas de redirection (peut-être connecté)');
          }
          
          // Test 4: Role separation - try with user credentials
          console.log('\n=== TEST 4: Role Separation ===');
          const userLoginOptions = {
            hostname: '127.0.0.1',
            port: 3001,
            path: '/api/auth/login',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            }
          };
          
          const userLoginData = JSON.stringify({
            email: 'user@logsystem.local',
            password: 'User@1234'
          });
          
          const userLoginReq = http.request(userLoginOptions, (userLoginRes) => {
            console.log(`User Login Status: ${userLoginRes.statusCode}`);
            
            const userCookies = userLoginRes.headers['set-cookie'] || [];
            const userSessionCookie = userCookies.find(c => c.startsWith('connect.sid='));
            const userCsrfCookie = userCookies.find(c => c.startsWith('csrf_token='));
            
            if (userLoginRes.statusCode === 200 && userSessionCookie && userCsrfCookie) {
              console.log('✅ Login user réussi');
              
              const userSessionId = userSessionCookie.split(';')[0].replace('connect.sid=', '');
              const userCsrfToken = userCsrfCookie.split(';')[0].replace('csrf_token=', '');
              
              // Try to access admin endpoint
              const adminOptions = {
                hostname: '127.0.0.1',
                port: 3001,
                path: '/api/admin/users',
                method: 'GET',
                headers: {
                  'Cookie': `connect.sid=${userSessionId}; csrf_token=${userCsrfToken}`,
                  'x-csrf-token': userCsrfToken
                }
              };
              
              const adminReq = http.request(adminOptions, (adminRes) => {
                let adminData = '';
                adminRes.on('data', (chunk) => { adminData += chunk; });
                adminRes.on('end', () => {
                  console.log(`Admin Access Status: ${adminRes.statusCode}`);
                  if (adminRes.statusCode === 403) {
                    console.log('✅ Accès admin refusé pour user standard');
                  } else {
                    console.log('❌ Accès admin permis pour user standard (PROBLÈME DE SÉCURITÉ)');
                  }
                  console.log('\n=== MODULE 2: AUTHENTIFICATION TERMINÉ ===');
                });
              });
              
              adminReq.on('error', (error) => {
                console.error('Admin access error:', error.message);
              });
              
              adminReq.end();
            } else {
              console.log('❌ Login user échoué');
            }
          });
          
          userLoginReq.on('error', (error) => {
            console.error('User login error:', error.message);
          });
          
          userLoginReq.write(userLoginData);
          userLoginReq.end();
        });
        
        protectedReq.on('error', (error) => {
          console.error('Protected page error:', error.message);
        });
        
        protectedReq.end();
      });
    });
    
    meReq.on('error', (error) => {
      console.error('Session persistence error:', error.message);
    });
    
    meReq.end();
  } else {
    console.log('❌ Login admin échoué');
  }
});

loginReq.on('error', (error) => {
  console.error('Login error:', error.message);
});

loginReq.write(loginData);
loginReq.end();