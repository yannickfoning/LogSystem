import http from 'http';
import mysql from 'mysql2/promise';

async function checkCounts() {
  // Check database count
  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'log'
  });
  const [count] = await conn.execute('SELECT COUNT(*) as total FROM logs');
  console.log('COUNT(*) FROM logs (DB "log"):', count[0].total);
  await conn.end();

  // Check API count
  const data = JSON.stringify({
    email: 'admin@logsystem.local',
    password: 'Admin@1234'
  });

  const req = http.request({
    hostname: '127.0.0.1',
    port: 3001,
    path: '/api/auth/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  }, (res) => {
    console.log('Login response status:', res.statusCode);
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      console.log('Login response body:', body);
      const cookies = res.headers['set-cookie'] || [];
      console.log('Cookies:', cookies);
      const sessionCookie = cookies.find(c => c.startsWith('connect.sid='));
      const csrfCookie = cookies.find(c => c.startsWith('csrf_token='));

      if (sessionCookie && csrfCookie) {
        const sessionId = sessionCookie.split(';')[0].replace('connect.sid=', '');
        const csrfToken = csrfCookie.split(';')[0].replace('csrf_token=', '');
        console.log('Session ID:', sessionId);
        console.log('CSRF Token:', csrfToken);

        const dashReq = http.request({
          hostname: '127.0.0.1',
          port: 3001,
          path: '/api/dashboard/per-level',
          method: 'GET',
          headers: {
            'Cookie': 'connect.sid=' + sessionId + '; csrf_token=' + csrfToken,
            'x-csrf-token': csrfToken
          }
        }, (dashRes) => {
          console.log('Dashboard response status:', dashRes.statusCode);
          let dashBody = '';
          dashRes.on('data', chunk => dashBody += chunk);
          dashRes.on('end', () => {
            console.log('Dashboard response body:', dashBody);
            try {
              const perLevel = JSON.parse(dashBody);
              const total = Object.values(perLevel).reduce((a, b) => a + b, 0);
              console.log('API /api/dashboard/per-level total:', total);
            } catch (e) {
              console.error('Failed to parse dashboard response:', e);
            }
          });
        });
        dashReq.on('error', console.error);
        dashReq.end();
      } else {
        console.error('Missing session or CSRF cookie');
      }
    });
  });

  req.on('error', console.error);
  req.write(data);
  req.end();
}

checkCounts().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});