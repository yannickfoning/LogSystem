/**
 * Test database setup and teardown utilities
 * Provides isolated test database environment
 */

import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

// Test database configuration - uses separate DB to avoid conflicts
const TEST_DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.TEST_DB_NAME || 'logsystem_test',
  multipleStatements: true
};

let testDbPool = null;

/**
 * Initialize test database connection
 * Schema is initialized by globalSetup.js
 */
export async function setupTestDb() {
  try {
    if (!testDbPool) {
      testDbPool = mysql.createPool(TEST_DB_CONFIG);
    }
    
    // Test connection
    await testDbPool.execute('SELECT 1');
    console.log('[TEST-DB] Test database connection established');
    
    return testDbPool;
  } catch (error) {
    console.error('[TEST-DB] Failed to connect to test database:', error.message);
    throw error;
  }
}

/**
 * Clean up test database connection
 */
export async function teardownTestDb() {
  if (testDbPool) {
    await testDbPool.end();
    testDbPool = null;
    console.log('[TEST-DB] Test database connection closed');
  }
}

/**
 * Clean all test data from database
 * Removes test users, logs, alerts, and other test artifacts
 */
export async function cleanTestData() {
  if (!testDbPool) {
    throw new Error('Test database not initialized');
  }

  const tables = [
    'logs',
    'error_groups', 
    'alerts',
    'alert_rules',
    'import_jobs',
    'audit_log',
    'watch_offsets'
  ];

  for (const table of tables) {
    try {
      // First try to delete with user scope
      await testDbPool.execute(`DELETE FROM ${table} WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@test.local')`);
    } catch (error) {
      // If that fails, try without scope (for tables without user_id)
      try {
        await testDbPool.execute(`DELETE FROM ${table}`);
      } catch (error2) {
        // Table might not exist or other constraints
        console.warn(`[TEST-DB] Failed to clean ${table}:`, error2.message);
      }
    }
  }

  // Clean test users
  try {
    await testDbPool.execute("DELETE FROM users WHERE email LIKE '%@test.local'");
  } catch (error) {
    console.warn('[TEST-DB] Failed to clean test users:', error.message);
  }
}

/**
 * Create test users with different roles
 */
export async function createTestUsers() {
  if (!testDbPool) {
    throw new Error('Test database not initialized');
  }

  const rounds = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
  const testPassword = 'Test@1234';
  const testHash = await bcrypt.hash(testPassword, rounds);

  // Create admin user
  const [adminResult] = await testDbPool.execute(
    `INSERT INTO users (email, password_hash, display_name, role, is_active)
     VALUES (?, ?, ?, 'admin', 1)`,
    ['admin@test.local', testHash, 'Test Admin']
  );

  // Create regular user
  const [userResult] = await testDbPool.execute(
    `INSERT INTO users (email, password_hash, display_name, role, is_active)
     VALUES (?, ?, ?, 'user', 1)`,
    ['user@test.local', testHash, 'Test User']
  );

  // Create analyst user
  const [analystResult] = await testDbPool.execute(
    `INSERT INTO users (email, password_hash, display_name, role, is_active)
     VALUES (?, ?, ?, 'analyst', 1)`,
    ['analyst@test.local', testHash, 'Test Analyst']
  );

  // Create inactive user for testing account locks
  const [inactiveResult] = await testDbPool.execute(
    `INSERT INTO users (email, password_hash, display_name, role, is_active)
     VALUES (?, ?, ?, 'user', 0)`,
    ['inactive@test.local', testHash, 'Inactive User']
  );

  return {
    admin: { id: adminResult.insertId, email: 'admin@test.local', password: testPassword },
    user: { id: userResult.insertId, email: 'user@test.local', password: testPassword },
    analyst: { id: analystResult.insertId, email: 'analyst@test.local', password: testPassword },
    inactive: { id: inactiveResult.insertId, email: 'inactive@test.local', password: testPassword }
  };
}

/**
 * Create sample test logs
 */
export async function createTestLogs(userId, count = 10) {
  if (!testDbPool) {
    throw new Error('Test database not initialized');
  }

  const now = new Date();
  const services = ['api-gateway', 'auth-service', 'payment-service'];
  const levels = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'];
  const messages = [
    'Request processed successfully',
    'User login from IP 192.168.1.100',
    'Database connection established',
    'Response time exceeded threshold: 2340ms',
    'Failed to connect to Redis',
    'Payment gateway timeout',
    'Invalid JWT token: expired',
    'Memory usage at 87%',
    'SSL certificate expiring in 7 days',
    'Slow query detected'
  ];

  const testLogs = [];
  for (let i = 0; i < count; i++) {
    const ts = new Date(now.getTime() - Math.random() * 24 * 60 * 60 * 1000);
    const timestamp = ts.toISOString().slice(0, 19).replace('T', ' ');
    const level = levels[Math.floor(Math.random() * levels.length)];
    const service = services[Math.floor(Math.random() * services.length)];
    const source = 'test-source';
    const message = messages[Math.floor(Math.random() * messages.length)];

    testLogs.push([timestamp, level, source, service, message, userId, now.toISOString().slice(0, 19).replace('T', ' ')]);
  }

  for (const logData of testLogs) {
    await testDbPool.execute(
      'INSERT INTO logs (timestamp, log_level, source, service, message, user_id, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      logData
    );
  }

  return testLogs.length;
}

/**
 * Create test alert rules
 */
export async function createTestAlertRules(userId) {
  if (!testDbPool) {
    throw new Error('Test database not initialized');
  }

  const rules = [
    {
      name: 'Test Error Alert',
      description: 'Test alert for ERROR level logs',
      condition_type: 'level',
      condition_value: 'ERROR',
      threshold_value: 5,
      time_window_minutes: 60,
      severity: 'high',
      cooldown_minutes: 30
    },
    {
      name: 'Test Critical Alert',
      description: 'Test alert for CRITICAL level logs',
      condition_type: 'level',
      condition_value: 'CRITICAL',
      threshold_value: 1,
      time_window_minutes: 60,
      severity: 'critical',
      cooldown_minutes: 15
    }
  ];

  const createdRules = [];
  for (const rule of rules) {
    const [result] = await testDbPool.execute(
      `INSERT INTO alert_rules (name, description, condition_type, condition_value, threshold_value, time_window_minutes, severity, cooldown_minutes, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [rule.name, rule.description, rule.condition_type, rule.condition_value, rule.threshold_value, rule.time_window_minutes, rule.severity, rule.cooldown_minutes, userId]
    );
    createdRules.push({ id: result.insertId, ...rule });
  }

  return createdRules;
}

/**
 * Get test database pool for direct access in tests
 */
export function getTestDbPool() {
  return testDbPool;
}

/**
 * Create a mock session object for testing
 */
export function createMockSession(user) {
  return {
    user: {
      id: user.id,
      email: user.email,
      display_name: user.email.split('@')[0],
      role: user.role || 'user',
      session_version: 0
    },
    regenerate: (callback) => callback(null),
    save: (callback) => callback(null),
    destroy: (callback) => callback(null)
  };
}

/**
 * Create a mock request object for testing
 */
export function createMockRequest(session, body = {}, query = {}, params = {}) {
  return {
    session,
    body,
    query,
    params,
    ip: '127.0.0.1',
    headers: {},
    cookies: {}
  };
}

/**
 * Create a mock response object for testing
 */
export function createMockResponse() {
  const res = {
    status: (code) => {
      res.statusCode = code;
      return res;
    },
    json: (data) => {
      res.jsonData = data;
      return res;
    },
    send: (data) => {
      res.sendData = data;
      return res;
    },
    setHeader: (name, value) => {
      if (!res.headers) res.headers = {};
      res.headers[name] = value;
      return res;
    },
    cookie: (name, value, options) => {
      if (!res.cookies) res.cookies = {};
      res.cookies[name] = { value, options };
      return res;
    },
    clearCookie: (name, options) => {
      if (!res.cookies) res.cookies = {};
      res.cookies[name] = { value: null, options };
      return res;
    },
    redirect: (url) => {
      res.redirectUrl = url;
      return res;
    },
    statusCode: 200,
    headers: {},
    cookies: {}
  };
  return res;
}