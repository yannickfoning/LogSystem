import dotenv from 'dotenv';
dotenv.config();

async function testLoginAPI() {
  try {
    // Test admin login
    console.log('=== Test API Login Admin ===');
    const adminResponse = await fetch('http://localhost:3001/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'admin@logsystem.local',
        password: 'Admin@1234'
      })
    });
    
    const adminData = await adminResponse.json();
    console.log('Admin login status:', adminResponse.status);
    console.log('Admin login response:', adminData);
    
    // Test user login
    console.log('\n=== Test API Login User ===');
    const userResponse = await fetch('http://localhost:3001/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'user@logsystem.local',
        password: 'User@1234'
      })
    });
    
    const userData = await userResponse.json();
    console.log('User login status:', userResponse.status);
    console.log('User login response:', userData);
    
  } catch (err) {
    console.error('❌ Erreur:', err.message);
  }
}

testLoginAPI();
