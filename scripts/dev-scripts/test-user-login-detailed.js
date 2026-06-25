import dotenv from 'dotenv';
dotenv.config();

async function testUserLoginDetailed() {
  console.log('=== Test détaillé du login utilisateur ===');
  
  try {
    // Étape 1: Récupérer la page login pour obtenir le cookie CSRF
    console.log('1. Récupération de la page login...');
    const loginPage = await fetch('http://localhost:3001/login.html');
    const cookies = loginPage.headers.get('set-cookie');
    console.log('Cookies reçus:', cookies);
    
    // Étape 2: Extraire le token CSRF des cookies
    let csrfToken = '';
    if (cookies) {
      const csrfMatch = cookies.match(/csrf_token=([^;]+)/);
      if (csrfMatch) {
        csrfToken = decodeURIComponent(csrfMatch[1]);
        console.log('Token CSRF trouvé:', csrfToken.substring(0, 20) + '...');
      }
    }
    
    // Étape 3: Tenter le login utilisateur
    console.log('2. Tentative de login utilisateur...');
    const loginResponse = await fetch('http://localhost:3001/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        'Cookie': cookies || ''
      },
      body: JSON.stringify({
        email: 'user@logsystem.local',
        password: 'User@1234'
      })
    });
    
    console.log('Status login:', loginResponse.status);
    const loginData = await loginResponse.json();
    console.log('Response login:', loginData);
    
    // Étape 4: Si succès, tester l'accès au dashboard
    if (loginResponse.ok) {
      console.log('3. Test accès dashboard utilisateur...');
      const dashboardResponse = await fetch('http://localhost:3001/api/auth/me', {
        headers: {
          'Cookie': cookies || ''
        }
      });
      
      if (dashboardResponse.ok) {
        const userData = await dashboardResponse.json();
        console.log('Données utilisateur:', userData);
        console.log('Role:', userData.role);
        console.log('Dashboard accessible:', userData.role === 'user' ? '✅' : '❌');
      } else {
        console.log('❌ Erreur accès dashboard:', dashboardResponse.status);
      }
    }
    
  } catch (err) {
    console.error('❌ Erreur:', err.message);
  }
}

testUserLoginDetailed();
