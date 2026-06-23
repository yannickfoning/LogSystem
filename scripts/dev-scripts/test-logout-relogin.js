import dotenv from 'dotenv';
dotenv.config();

async function testLogoutRelogin() {
  console.log('=== Test cycle complet login → logout → re-login ===');
  
  try {
    // Étape 1: Premier login
    console.log('1. Premier login utilisateur...');
    const loginPage1 = await fetch('http://localhost:3001/login.html');
    const cookies1 = loginPage1.headers.get('set-cookie') || '';
    
    const csrfMatch1 = cookies1.match(/csrf_token=([^;]+)/);
    const csrfToken1 = csrfMatch1 ? decodeURIComponent(csrfMatch1[1]) : '';
    
    const loginResponse1 = await fetch('http://localhost:3001/api/auth/login', {
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
    
    console.log('Status premier login:', loginResponse1.status);
    if (loginResponse1.ok) {
      const sessionCookies1 = loginResponse1.headers.get('set-cookie') || '';
      console.log('✅ Premier login réussi');
      
      // Étape 2: Vérifier la session
      const meResponse1 = await fetch('http://localhost:3001/api/auth/me', {
        headers: { 'Cookie': sessionCookies1 }
      });
      console.log('Session avant logout:', meResponse1.ok ? '✅ Active' : '❌ Inactive');
      
      // Étape 3: Logout
      console.log('2. Déconnexion...');
      const logoutResponse = await fetch('http://localhost:3001/api/auth/logout', {
        method: 'POST',
        headers: { 'Cookie': sessionCookies1 }
      });
      console.log('Status logout:', logoutResponse.status);
      
      // Étape 4: Vérifier que la session est détruite
      const meResponse2 = await fetch('http://localhost:3001/api/auth/me', {
        headers: { 'Cookie': sessionCookies1 }
      });
      console.log('Session après logout:', meResponse2.ok ? '❌ Encore active' : '✅ Détruite');
      
      // Étape 5: Deuxième login (re-login)
      console.log('3. Tentative de re-login...');
      const loginPage2 = await fetch('http://localhost:3001/login.html');
      const cookies2 = loginPage2.headers.get('set-cookie') || '';
      
      const csrfMatch2 = cookies2.match(/csrf_token=([^;]+)/);
      const csrfToken2 = csrfMatch2 ? decodeURIComponent(csrfMatch2[1]) : '';
      
      const loginResponse2 = await fetch('http://localhost:3001/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken2,
          'Cookie': cookies2
        },
        body: JSON.stringify({
          email: 'user@logsystem.local',
          password: 'User@1234'
        })
      });
      
      console.log('Status re-login:', loginResponse2.status);
      if (loginResponse2.ok) {
        console.log('✅ Re-login réussi');
        
        // Étape 6: Vérifier la nouvelle session
        const sessionCookies2 = loginResponse2.headers.get('set-cookie') || '';
        const meResponse3 = await fetch('http://localhost:3001/api/auth/me', {
          headers: { 'Cookie': sessionCookies2 }
        });
        console.log('Nouvelle session:', meResponse3.ok ? '✅ Active' : '❌ Inactive');
      } else {
        const errorData = await loginResponse2.json();
        console.log('❌ Erreur re-login:', errorData);
      }
    } else {
      const errorData = await loginResponse1.json();
      console.log('❌ Erreur premier login:', errorData);
    }
    
  } catch (err) {
    console.error('❌ Erreur:', err.message);
  }
}

testLogoutRelogin();
