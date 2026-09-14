/**
 * Script de débogage des endpoints API
 */
import http from 'http';

const BASE_URL = 'http://127.0.0.1:3001';

async function debugEndpoints() {
  console.log('=== DÉBOGAGE ENDPOINTS API ===\n');
  
  let sessionCookie = null;
  let csrfToken = null;
  let cookieHeader = null;
  
  // 1. Login
  console.log('1. LOGIN');
  const loginData = JSON.stringify({
    email: 'admin@logsystem.local',
    password: 'Admin@1234'
  });
  
  const loginResult = await makeRequest('/api/auth/login', 'POST', loginData);
  console.log('   Status:', loginResult.statusCode);
  console.log('   Response:', loginResult.body);
  
  if (loginResult.statusCode !== 200) {
    console.log('   ❌ Login échoué - arrêt du test');
    return false;
  }
  
  sessionCookie = loginResult.cookies.find(c => c.startsWith('connect.sid='));
  const csrfCookieLocal = loginResult.cookies.find(c => c.startsWith('csrf_token='));
  
  if (!sessionCookie || !csrfCookieLocal) {
    console.log('   ❌ Cookies manquants');
    return false;
  }
  
  const sessionId = sessionCookie.split(';')[0].replace('connect.sid=', '');
  csrfToken = csrfCookieLocal.split(';')[0].replace('csrf_token=', '');
  cookieHeader = `connect.sid=${sessionId}; csrf_token=${csrfToken}`;
  
  console.log('   ✅ Login réussi');
  
  // 2. Test chaque endpoint individuellement
  const endpoints = [
    { path: '/api/auth/me', method: 'GET', name: 'Session utilisateur' },
    { path: '/api/dashboard/summary', method: 'GET', name: 'Dashboard summary' },
    { path: '/api/dashboard/per-level', method: 'GET', name: 'Dashboard per-level' },
    { path: '/api/dashboard/trends', method: 'GET', name: 'Dashboard trends' },
    { path: '/api/logs?limit=5', method: 'GET', name: 'Logs list' },
    { path: '/api/logs/search?query=ERROR', method: 'GET', name: 'Logs search' },
    { path: '/api/alerts', method: 'GET', name: 'Alerts list' },
    { path: '/api/admin/users', method: 'GET', name: 'Admin users' },
    { path: '/api/admin/system-stats', method: 'GET', name: 'Admin system stats' },
    { path: '/api/watchdogs/status', method: 'GET', name: 'Watcher status' },
  ];
  
  console.log('\n2. TEST ENDPOINTS INDIVIDUELS');
  for (const endpoint of endpoints) {
    console.log(`\n   Testing: ${endpoint.name} (${endpoint.method} ${endpoint.path})`);
    const result = await makeRequest(endpoint.path, endpoint.method, null, cookieHeader, csrfToken);
    console.log(`   Status: ${result.statusCode}`);
    
    if (result.statusCode === 200) {
      try {
        const data = JSON.parse(result.body);
        console.log(`   ✅ Succès - Type: ${Array.isArray(data) ? 'Array' : typeof data}`);
        if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
          const keys = Object.keys(data);
          if (keys.length <= 5) {
            console.log(`   Keys: ${keys.join(', ')}`);
          } else {
            console.log(`   Keys: ${keys.slice(0, 5).join(', ')}... (${keys.length} total)`);
          }
        }
      } catch (e) {
        console.log(`   ⚠️  Response non-JSON: ${result.body.substring(0, 100)}...`);
      }
    } else if (result.statusCode === 500) {
      console.log(`   ❌ Erreur serveur: ${result.body.substring(0, 200)}...`);
    } else if (result.statusCode === 404) {
      console.log(`   ⚠️  Endpoint non trouvé`);
    } else if (result.statusCode === 401 || result.statusCode === 403) {
      console.log(`   ⚠️  Erreur auth/permission`);
    } else {
      console.log(`   ⚠️  Status inattendu: ${result.body.substring(0, 100)}...`);
    }
  }
  
  console.log('\n=== FIN DÉBOGAGE ===');
  return true;
}

function makeRequest(path, method = 'GET', data = null, cookie = null, csrfToken = null) {
  return new Promise((resolve) => {
    const options = {
      hostname: '127.0.0.1',
      port: 3001,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    
    if (cookie) {
      options.headers['Cookie'] = cookie;
    }
    
    if (csrfToken && method !== 'GET') {
      options.headers['x-csrf-token'] = csrfToken;
    }
    
    if (data) {
      options.headers['Content-Length'] = Buffer.byteLength(data);
    }
    
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          cookies: res.headers['set-cookie'] || [],
          body: body
        });
      });
    });
    
    req.on('error', (error) => {
      resolve({
        statusCode: 500,
        error: error.message,
        cookies: [],
        body: error.message
      });
    });
    
    if (data) {
      req.write(data);
    }
    req.end();
  });
}

debugEndpoints().then(success => {
  process.exit(success ? 0 : 1);
}).catch(err => {
  console.error('Erreur:', err.message);
  process.exit(1);
});
