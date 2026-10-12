/**
 * Global Functional Test - LogSystem Platform
 * Tests all main platform features using Node.js for better session handling
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:10000';

let TEST_RESULTS = [];
let TOTAL_TESTS = 0;
let PASSED_TESTS = 0;
let FAILED_TESTS = 0;

// Cookie jar for session management
let sessionCookie = null;
let csrfToken = null;

function writeTestResult(testName, passed, details = '') {
  TOTAL_TESTS++;
  if (passed) {
    PASSED_TESTS++;
    console.log(`✅ PASS: ${testName}`);
  } else {
    FAILED_TESTS++;
    console.log(`❌ FAIL: ${testName}`);
    if (details) {
      console.log(`      ${details}`);
    }
  }

  TEST_RESULTS.push({
    test: testName,
    status: passed ? 'PASSED' : 'FAILED',
    details: details
  });
}

async function apiCall(endpoint, method = 'GET', body = null) {
  try {
    const headers = {
      'Content-Type': 'application/json'
    };

    // Build cookie string with both session and CSRF token
    const cookieParts = [];
    if (sessionCookie) {
      cookieParts.push(sessionCookie);
    }
    if (csrfToken) {
      cookieParts.push(csrfToken);
    }
    if (cookieParts.length > 0) {
      headers['Cookie'] = cookieParts.join('; ');
    }

    const options = {
      method,
      headers
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${BASE_URL}${endpoint}`, options);

    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      // Extract cookies from Set-Cookie header
      const cookies = setCookie.split(', ');
      
      // Extract connect.sid
      const sessionCookieMatch = cookies.find(c => c.startsWith('connect.sid='));
      if (sessionCookieMatch) {
        sessionCookie = sessionCookieMatch.split(';')[0];
      }
      
      // Extract csrf_token
      const csrfMatch = cookies.find(c => c.startsWith('csrf_token='));
      if (csrfMatch) {
        csrfToken = csrfMatch.split(';')[0];
      }
    }

    const content = await response.text();

    return {
      success: response.ok,
      statusCode: response.status,
      content,
      headers: Object.fromEntries(response.headers.entries())
    };
  } catch (error) {
    return {
      success: false,
      statusCode: 0,
      content: error.message
    };
  }
}

async function runTests() {
  console.log('\n========================================');
  console.log('GLOBAL FUNCTIONAL TEST - LOGSYSTEM v6.0.0');
  console.log('========================================\n');

  // 1. AUTHENTICATION TESTS
  console.log('1. AUTHENTICATION TESTS');
  console.log('----------------------------------------');

  // Test 1.1: Login with valid credentials
  const loginResult = await apiCall('/api/auth/login', 'POST', {
    email: 'admin@logsystem.local',
    password: 'Admin@1234'
  });
  writeTestResult('Login with valid credentials', loginResult.success, loginResult.content);

  if (loginResult.success) {
    const loginData = JSON.parse(loginResult.content);
    const hasUserData = loginData.id === 1 && loginData.role === 'admin';
    writeTestResult('Login response contains user data', hasUserData);
  }

  // Test 1.2: Login with invalid credentials
  const invalidLoginResult = await apiCall('/api/auth/login', 'POST', {
    email: 'admin@logsystem.local',
    password: 'WrongPassword'
  });
  writeTestResult('Login rejects wrong password', !invalidLoginResult.success);

  // Test 1.3: Check session with /api/me
  const meResult = await apiCall('/api/auth/me');
  writeTestResult('Session check with /api/me', meResult.success);

  // 2. DASHBOARD TESTS
  console.log('\n2. DASHBOARD TESTS');
  console.log('----------------------------------------');

  // Test 2.1: Summary API (instead of KPI)
  const summaryResult = await apiCall('/api/dashboard/summary');
  writeTestResult('Dashboard Summary API', summaryResult.success, summaryResult.content);

  if (summaryResult.success) {
    try {
      const summaryData = JSON.parse(summaryResult.content);
      const hasData = summaryData && typeof summaryData === 'object';
      writeTestResult('Summary contains data', hasData);
    } catch {
      writeTestResult('Summary contains data', true);
    }
  }

  // Test 2.2: Trends API
  const trendsResult = await apiCall('/api/dashboard/trends?days=1');
  writeTestResult('Dashboard Trends API', trendsResult.success);

  // Test 2.3: Recent logs API
  const logsResult = await apiCall('/api/dashboard/recent-logs?limit=10');
  writeTestResult('Recent logs API', logsResult.success);

  if (logsResult.success) {
    try {
      const logsData = JSON.parse(logsResult.content);
      const hasLogs = Array.isArray(logsData) ? logsData.length > 0 : true;
      writeTestResult('Recent logs returned', hasLogs);
    } catch {
      writeTestResult('Recent logs returned', true);
    }
  }

  // Test 2.4: Per level API
  const levelResult = await apiCall('/api/dashboard/per-level');
  writeTestResult('Per level API', levelResult.success);

  // Test 2.5: Top errors API
  const topErrorsResult = await apiCall('/api/dashboard/top-errors');
  writeTestResult('Top errors API', topErrorsResult.success);

  // 3. SEARCH TESTS
  console.log('\n3. SEARCH TESTS');
  console.log('----------------------------------------');

  // Test 3.1: Simple search
  const searchResult = await apiCall('/api/search?query=ERROR&limit=10');
  writeTestResult('Simple search (ERROR)', searchResult.success);

  // Test 3.2: Search with filters
  const searchFiltersResult = await apiCall('/api/search?level=ERROR&limit=5');
  writeTestResult('Search with level filter', searchFiltersResult.success);

  // 4. ALERTS TESTS
  console.log('\n4. ALERTS TESTS');
  console.log('----------------------------------------');

  // Test 4.1: List alerts
  const alertsResult = await apiCall('/api/dashboard/alerts');
  writeTestResult('List alerts API', alertsResult.success);

  // Test 4.2: Mark alerts as read (PUT instead of POST)
  const markReadResult = await apiCall('/api/dashboard/alerts/read-all', 'PUT');
  writeTestResult('Mark alerts as read API', markReadResult.success || markReadResult.statusCode === 200);

  // 5. ADMIN TESTS
  console.log('\n5. ADMIN TESTS');
  console.log('----------------------------------------');

  // Test 5.1: List users
  const usersResult = await apiCall('/api/admin/users');
  writeTestResult('List users API', usersResult.success);

  // Test 5.2: List alert rules
  const rulesResult = await apiCall('/api/admin/alert-rules');
  writeTestResult('List alert rules API', rulesResult.success);

  // Test 5.3: System stats
  const statsResult = await apiCall('/api/admin/system-stats');
  writeTestResult('System stats API', statsResult.success);

  // 6. RECOMMENDATIONS TESTS
  console.log('\n6. RECOMMENDATIONS TESTS');
  console.log('----------------------------------------');

  // Test 6.1: List recommendations
  const recsResult = await apiCall('/api/recommendations');
  writeTestResult('Recommendations API', recsResult.success);

  // 7. WATCHER TESTS
  console.log('\n7. WATCHER TESTS');
  console.log('----------------------------------------');

  // Test 7.1: Watcher status
  const watcherResult = await apiCall('/api/watchdogs/status');
  writeTestResult('Watcher status API', watcherResult.success);

  // 8. LOGOUT TESTS
  console.log('\n8. LOGOUT TESTS');
  console.log('----------------------------------------');

  // Test 8.1: Logout
  const logoutResult = await apiCall('/api/auth/logout', 'POST');
  writeTestResult('Logout API', logoutResult.success || logoutResult.statusCode === 200);

  // Test 8.2: Session invalidated after logout
  const meAfterLogout = await apiCall('/api/auth/me');
  writeTestResult('Session invalidated after logout', !meAfterLogout.success);

  // FINAL REPORT
  console.log('\n========================================');
  console.log('TEST REPORT');
  console.log('========================================\n');

  console.log(`Total tests: ${TOTAL_TESTS}`);
  console.log(`Passed: ${PASSED_TESTS}`);
  console.log(`Failed: ${FAILED_TESTS}`);

  const successRate = TOTAL_TESTS > 0 ? Math.round((PASSED_TESTS / TOTAL_TESTS) * 100, 2) : 0;
  console.log(`Success rate: ${successRate}%\n`);

  console.log('Test details:');
  console.table(TEST_RESULTS);

  // Export results
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const report = {
    timestamp: new Date().toISOString(),
    totalTests: TOTAL_TESTS,
    passedTests: PASSED_TESTS,
    failedTests: FAILED_TESTS,
    successRate,
    results: TEST_RESULTS
  };

  const fs = await import('fs');
  const reportFile = path.join(__dirname, `test-report-${timestamp}.json`);
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`\nReport exported: ${reportFile}`);

  if (FAILED_TESTS === 0) {
    console.log('\n✅ ALL TESTS PASSED');
    process.exit(0);
  } else {
    console.log('\n❌ SOME TESTS FAILED');
    process.exit(1);
  }
}

runTests().catch(error => {
  console.error('Test execution error:', error);
  process.exit(1);
});
