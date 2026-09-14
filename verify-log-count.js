import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import http from 'http';
dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'log'
});

async function verifyLogCount() {
  const conn = await pool.getConnection();
  
  try {
    console.log('=== VÉRIFICATION INHÉRENCENCE COMPTE LOGS ===\n');
    
    // Check total logs in database
    const [totalLogs] = await conn.query('SELECT COUNT(*) as cnt FROM logs');
    console.log('COUNT(*) FROM logs:', totalLogs[0].cnt);
    
    // Check logs by user
    const [logsByUser] = await conn.query('SELECT user_id, COUNT(*) as cnt FROM logs GROUP BY user_id');
    console.log('Logs par user_id:');
    logsByUser.forEach(row => {
      console.log(` - user_id ${row.user_id}: ${row.cnt} logs`);
    });
    
    // Check recent logs
    const [recentLogs] = await conn.query('SELECT COUNT(*) as cnt FROM logs WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 1 HOUR)');
    console.log('Logs dernière heure:', recentLogs[0].cnt);
    
    // Now test API endpoint
    const loginData = JSON.stringify({
      email: 'admin@logsystem.local',
      password: 'Admin@1234'
    });
    
    const loginReq = http.request({
      hostname: '127.0.0.1',
      port: 3001,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': loginData.length
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          const cookies = res.headers['set-cookie'] || [];
          const sessionCookie = cookies.find(c => c.startsWith('connect.sid='));
          const csrfCookie = cookies.find(c => c.startsWith('csrf_token='));
          
          if (sessionCookie && csrfCookie) {
            const sessionId = sessionCookie.split(';')[0].replace('connect.sid=', '');
            const csrfToken = csrfCookie.split(';')[0].replace('csrf_token=', '');
            
            // Test per-level endpoint
            const perLevelReq = http.request({
              hostname: '127.0.0.1',
              port: 3001,
              path: '/api/dashboard/per-level',
              method: 'GET',
              headers: {
                'Cookie': `connect.sid=${sessionId}; csrf_token=${csrfToken}`,
                'x-csrf-token': csrfToken
              }
            }, (perLevelRes) => {
              let perLevelBody = '';
              perLevelRes.on('data', chunk => perLevelBody += chunk);
              perLevelRes.on('end', () => {
                console.log('\n=== API /api/dashboard/per-level ===');
                console.log('Status:', perLevelRes.statusCode);
                if (perLevelRes.statusCode === 200) {
                  const data = JSON.parse(perLevelBody);
                  const apiTotal = Object.values(data).reduce((a, b) => a + b, 0);
                  console.log('Données API:', data);
                  console.log('Total API:', apiTotal);
                  
                  console.log('\n=== COMPARAISON ===');
                  console.log('Base de données COUNT(*):', totalLogs[0].cnt);
                  console.log('API per-level total:', apiTotal);
                  
                  if (totalLogs[0].cnt === apiTotal) {
                    console.log('✅ COHÉRENT: Les comptes correspondent');
                  } else {
                    console.log('❌ INCOHÉRENT: Écart de', totalLogs[0].cnt - apiTotal, 'logs');
                    console.log('Possibles causes: filtre user_id, fenêtre temporelle, ou agrégation incorrecte');
                  }
                }
              });
            });
            
            perLevelReq.on('error', console.error);
            perLevelReq.end();
          }
        }
      });
    });
    
    loginReq.on('error', console.error);
    loginReq.write(loginData);
    loginReq.end();
    
  } finally {
    conn.release();
    await pool.end();
  }
}

verifyLogCount().catch(console.error);