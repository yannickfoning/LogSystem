import http from 'http';

// Test protected page redirect without authentication
console.log('=== TEST: Protected Page Redirect (No Auth) ===');

const protectedOptions = {
  hostname: '127.0.0.1',
  port: 3001,
  path: '/dashboard.html',
  method: 'GET',
  headers: {}
};

const protectedReq = http.request(protectedOptions, (protectedRes) => {
  console.log(`Status: ${protectedRes.statusCode}`);
  console.log('Headers:', protectedRes.headers);
  
  if (protectedRes.statusCode === 302) {
    console.log('✅ Redirection vers login (non connecté)');
    console.log('Location:', protectedRes.headers.location);
  } else if (protectedRes.statusCode === 200) {
    console.log('⚠️ Page accessible sans auth (PROBLÈME)');
  } else {
    console.log('Statut inattendu:', protectedRes.statusCode);
  }
});

protectedReq.on('error', (error) => {
  console.error('Protected page error:', error.message);
});

protectedReq.end();