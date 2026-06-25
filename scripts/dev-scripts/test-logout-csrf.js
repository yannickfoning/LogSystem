import dotenv from 'dotenv';
dotenv.config();

async function testLogoutWithCSRF() {
  console.log('=== Test logout avec CSRF correct ===');
  
  try {
    // Étape 1: Login pour obtenir une session
    console.log('1. Login utilisateur...');
    const loginPage = await fetch('http://localhost:3001/login.html');
    const cookies1 = loginPage.headers.get('set-cookie') || '';
    
    const csrfMatch1 = cookies1.match(/csrf_token=([^;]+)/);
    const csrfToken1 = csrfMatch1 ? decodeURIComponent(csrfMatch1[1]) : '';
    
    const loginResponse = await fetch('http://localhost:3001/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken1,
        'Cookie': cookies1
      },
      body: JSON.stringify({
        email: 'user@logsystem.local',
        password: 'User@1234'
      })
    });
    
    if (loginResponse.ok) {
      const sessionCookies = loginResponse.headers.get('set-cookie') || '';
      console.log('✅ Login réussi');
      
      // Étape 2: Obtenir un nouveau token CSRF pour le logout
      console.log('2. Récupération nouveau CSRF pour logout...');
      const loginPage2 = await fetch('http://localhost:3001/login.html', {
        headers: { 'Cookie': sessionCookies }
      });
      const cookies2 = loginPage2.headers.get('set-cookie') || '';
      
      const csrfMatch2 = cookies2.match(/csrf_token=([^;]+)/);
      const csrfToken2 = csrfMatch2 ? decodeURIComponent(csrfMatch2[1]) : '';
      
      // Étape 3: Logout avec CSRF
      console.log('3. Logout avec CSRF...');
      const logoutResponse = await fetch('http://localhost:3001/api/auth/logout', {
        method: 'POST',
        headers: {
          'Cookie': sessionCookies,
          'X-CSRF-Token': csrfToken2
        }
      });
      
      console.log('Status logout:', logoutResponse.status);
      const logoutData = await logoutResponse.json();
      console.log('Response logout:', logoutData);
      
      // Étape 4: Vérifier que la session est détruite
      const meResponse = await fetch('http://localhost:3001/api/auth/me', {
        headers: { 'Cookie': sessionCookies }
      });
      console.log('Session après logout:', meResponse.ok ? '❌ Encore active' : '✅ Détruite');
      
      // Étape 5: Re-login
      console.log('4. Re-login...');
      const loginPage3 = await fetch('http://localhost:3001/login.html');
      const cookies3 = loginPage3.headers.get('set-cookie') || '';
      
      const csrfMatch3 = cookies3.match(/csrf_token=([^;]+)/);
      const csrfToken3 = csrfMatch3 ? decodeURIComponent(csrfMatch3[1]) : '';
      
      const reloginResponse = await fetch('http://localhost:3001/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken3,
          'Cookie': cookies3
        },
        body: JSON.stringify({
          email: 'user@logsystem.local',
          password: 'User@1234'
        })
      });
      
      console.log('Status re-login:', reloginResponse.status);
      console.log('Re-login:', reloginResponse.ok ? '✅ Succès' : '❌ Échec');
    }
    
  } catch (err) {
    console.error('❌ Erreur:', err.message);
  }
}

testLogoutWithCSRF();
