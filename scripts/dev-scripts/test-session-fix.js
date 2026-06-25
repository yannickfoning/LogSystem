import dotenv from 'dotenv';
dotenv.config();

async function testSessionFix() {
  console.log('=== Test avec gestion de session complète ===');
  
  try {
    // Étape 1: Récupérer la page login pour obtenir les cookies
    console.log('1. Récupération page login...');
    const loginPageResponse = await fetch('http://localhost:3001/login.html');
    const setCookies = loginPageResponse.headers.get('set-cookie') || '';
    console.log('Cookies initiaux:', setCookies);
    
    // Étape 2: Login avec les cookies
    console.log('2. Login utilisateur...');
    const loginResponse = await fetch('http://localhost:3001/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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
    
    // Étape 3: Récupérer les nouveaux cookies après login
    const newCookies = loginResponse.headers.get('set-cookie') || '';
    console.log('Cookies après login:', newCookies);
    
    // Étape 4: Tester l'accès au dashboard avec les nouveaux cookies
    if (loginResponse.ok) {
      console.log('3. Test accès dashboard avec session...');
      const dashboardResponse = await fetch('http://localhost:3001/api/auth/me', {
        headers: {
          'Cookie': newCookies
        }
      });
      
      console.log('Status dashboard:', dashboardResponse.status);
      if (dashboardResponse.ok) {
        const userData = await dashboardResponse.json();
        console.log('✅ Session utilisateur établie:');
        console.log('  - ID:', userData.id);
        console.log('  - Email:', userData.email);
        console.log('  - Role:', userData.role);
        console.log('  - Dashboard accessible:', userData.role === 'user' ? '✅' : '❌');
      } else {
        const errorData = await dashboardResponse.json();
        console.log('❌ Erreur dashboard:', errorData);
      }
    }
    
  } catch (err) {
    console.error('❌ Erreur:', err.message);
  }
}

testSessionFix();
