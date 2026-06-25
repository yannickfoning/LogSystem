import dotenv from 'dotenv';
dotenv.config();

async function testCSRFLogin() {
  console.log('=== Test login avec CSRF correct ===');
  
  try {
    // Étape 1: Récupérer la page login pour obtenir le cookie CSRF
    console.log('1. Récupération page login...');
    const loginPageResponse = await fetch('http://localhost:3001/login.html');
    const setCookies = loginPageResponse.headers.get('set-cookie') || '';
    console.log('Cookies CSRF:', setCookies);
    
    // Extraire le token CSRF
    let csrfToken = '';
    if (setCookies) {
      const csrfMatch = setCookies.match(/csrf_token=([^;]+)/);
      if (csrfMatch) {
        csrfToken = decodeURIComponent(csrfMatch[1]);
        console.log('Token CSRF extrait:', csrfToken.substring(0, 20) + '...');
      }
    }
    
    // Étape 2: Login avec CSRF et cookies
    console.log('2. Login avec CSRF...');
    const loginResponse = await fetch('http://localhost:3001/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        'Cookie': setCookies
      },
      body: JSON.stringify({
        email: 'user@logsystem.local',
        password: 'User@1234'
      })
    });
    
    console.log('Status login:', loginResponse.status);
    const loginData = await loginResponse.json();
    console.log('Response login:', loginData);
    
    // Étape 3: Récupérer les cookies de session après login
    const sessionCookies = loginResponse.headers.get('set-cookie') || '';
    console.log('Cookies de session:', sessionCookies);
    
    // Étape 4: Tester l'accès au dashboard avec la session
    if (loginResponse.ok) {
      console.log('3. Test accès dashboard...');
      const dashboardResponse = await fetch('http://localhost:3001/api/auth/me', {
        headers: {
          'Cookie': sessionCookies
        }
      });
      
      console.log('Status dashboard:', dashboardResponse.status);
      if (dashboardResponse.ok) {
        const userData = await dashboardResponse.json();
        console.log('✅ SUCCÈS - Session utilisateur établie:');
        console.log('  - ID:', userData.id);
        console.log('  - Email:', userData.email);
        console.log('  - Role:', userData.role);
        console.log('  - Dashboard accessible:', userData.role === 'user' ? '✅ OUI' : '❌ NON');
      } else {
        const errorData = await dashboardResponse.json();
        console.log('❌ Erreur dashboard:', errorData);
      }
    }
    
  } catch (err) {
    console.error('❌ Erreur:', err.message);
  }
}

testCSRFLogin();
