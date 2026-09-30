import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:10000';

async function testFunctionalComprehensive() {
  console.log('Running comprehensive functional tests...');
  
  // Login
  const loginResponse = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: 'admin@logsystem.local',
      password: 'Admin@1234'
    })
  });
  
  if (loginResponse.status !== 200) {
    console.log('❌ Login failed');
    return;
  }
  
  console.log('✅ Login successful');
  
  // Get session cookie
  const cookies = loginResponse.headers.get('set-cookie');
  const connectSidMatch = cookies.match(/connect\.sid=([^;]+)/);
  const connectSid = `connect.sid=${connectSidMatch[1]}`;
  
  console.log('Session cookie:', connectSid);
  
  // Test dashboard summary
  const summaryResponse = await fetch(`${BASE_URL}/api/dashboard/summary`, {
    headers: {
      'Cookie': connectSid
    }
  });
  
  console.log('Dashboard summary status:', summaryResponse.status);
  if (summaryResponse.status === 200) {
    console.log('✅ Dashboard summary works');
    const summaryData = await summaryResponse.json();
    console.log('Total logs:', summaryData.totalLogs);
  } else {
    console.log('❌ Dashboard summary failed');
  }
  
  // Test dashboard filters
  const filterTests = [
    '?level=ERROR',
    '?platform=Production',
    '?sourceType=import',
    '?timeRange=24h'
  ];
  
  let passedFilters = 0;
  for (const filter of filterTests) {
    const response = await fetch(`${BASE_URL}/api/dashboard/recent-logs${filter}`, {
      headers: {
        'Cookie': connectSid
      }
    });
    
    if (response.status === 200) {
      passedFilters++;
      console.log(`✅ Filter ${filter} works`);
    } else {
      console.log(`❌ Filter ${filter} failed: ${response.status}`);
    }
  }
  
  console.log(`Filters: ${passedFilters}/${filterTests.length} passed`);
  
  // Test alerts
  const alertsResponse = await fetch(`${BASE_URL}/api/dashboard/alerts`, {
    headers: {
      'Cookie': connectSid
    }
  });
  
  console.log('Alerts status:', alertsResponse.status);
  if (alertsResponse.status === 200) {
    console.log('✅ Alerts work');
  } else {
    console.log('❌ Alerts failed');
  }
  
  // Test search
  const searchResponse = await fetch(`${BASE_URL}/api/search?query=error&limit=10`, {
    headers: {
      'Cookie': connectSid
    }
  });
  
  console.log('Search status:', searchResponse.status);
  if (searchResponse.status === 200) {
    console.log('✅ Search works');
  } else {
    console.log('❌ Search failed');
  }
}

testFunctionalComprehensive().catch(console.error);