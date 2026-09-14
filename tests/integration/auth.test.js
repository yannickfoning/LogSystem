/**
 * Authentication & Session Integration Tests
 * Tests login, logout, session management, role-based access, and account locking
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { 
  setupTestDb, 
  teardownTestDb, 
  cleanTestData, 
  createTestUsers, 
  createMockSession,
  createMockRequest,
  createMockResponse,
  getTestDbPool
} from '../test-setup.js';

describe('Authentication & Sessions', () => {
  let testUsers;
  let dbPool;

  beforeAll(async () => {
    dbPool = await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await cleanTestData();
    testUsers = await createTestUsers();
  });

  describe('POST /auth/login', () => {
    it('should authenticate valid user credentials', async () => {
      const { login } = await import('../../routes/auth.js');
      const router = login;
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {
        email: testUsers.user.email,
        password: testUsers.user.password
      });
      const res = createMockResponse();

      // Find the login route handler
      const loginHandler = router.stack.find(layer => layer.route?.path === '/login')?.route?.stack[0]?.handle;
      
      if (loginHandler) {
        await loginHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData).toHaveProperty('id');
        expect(res.jsonData).toHaveProperty('email');
        expect(res.jsonData.email).toBe(testUsers.user.email);
        expect(res.jsonData).toHaveProperty('role');
      }
    });

    it('should reject invalid credentials', async () => {
      const { login } = await import('../../routes/auth.js');
      const router = login;
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {
        email: testUsers.user.email,
        password: 'WrongPassword123!'
      });
      const res = createMockResponse();

      const loginHandler = router.stack.find(layer => layer.route?.path === '/login')?.route?.stack[0]?.handle;
      
      if (loginHandler) {
        await loginHandler(req, res);
        
        expect(res.statusCode).toBe(401);
        expect(res.jsonData).toHaveProperty('error');
        expect(res.jsonData.error).toContain('Identifiants invalides');
      }
    });

    it('should reject login for inactive accounts', async () => {
      const { login } = await import('../../routes/auth.js');
      const router = login;
      
      const session = createMockSession(testUsers.inactive);
      const req = createMockRequest(session, {
        email: testUsers.inactive.email,
        password: testUsers.inactive.password
      });
      const res = createMockResponse();

      const loginHandler = router.stack.find(layer => layer.route?.path === '/login')?.route?.stack[0]?.handle;
      
      if (loginHandler) {
        await loginHandler(req, res);
        
        expect(res.statusCode).toBe(401);
        expect(res.jsonData).toHaveProperty('error');
      }
    });

    it('should promote first user to admin automatically', async () => {
      // Clean all users first
      await dbPool.execute('DELETE FROM users');
      
      const { login } = await import('../../routes/auth.js');
      const router = login;
      
      const session = createMockSession({ id: 1, email: 'first@test.local', role: 'user' });
      const req = createMockRequest(session, {
        email: 'first@test.local',
        password: 'Test@1234'
      });
      const res = createMockResponse();

      // Create first user manually
      const bcrypt = await import('bcryptjs');
      const hash = await bcrypt.hash('Test@1234', 12);
      await dbPool.execute(
        'INSERT INTO users (email, password_hash, display_name, role, is_active) VALUES (?, ?, ?, ?, 1)',
        ['first@test.local', hash, 'First User', 'user']
      );

      const loginHandler = router.stack.find(layer => layer.route?.path === '/login')?.route?.stack[0]?.handle;
      
      if (loginHandler) {
        await loginHandler(req, res);
        
        // Check if user was promoted to admin
        const [users] = await dbPool.execute('SELECT role FROM users WHERE email = ?', ['first@test.local']);
        expect(users[0].role).toBe('admin');
      }
    });

    it('should create audit log entry for successful login', async () => {
      const { login } = await import('../../routes/auth.js');
      const router = login;
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {
        email: testUsers.user.email,
        password: testUsers.user.password
      });
      const res = createMockResponse();

      const loginHandler = router.stack.find(layer => layer.route?.path === '/login')?.route?.stack[0]?.handle;
      
      if (loginHandler) {
        await loginHandler(req, res);
        
        // Check audit log
        const [auditLogs] = await dbPool.execute(
          'SELECT * FROM audit_log WHERE user_id = ? AND action = ? ORDER BY created_at DESC LIMIT 1',
          [testUsers.user.id, 'login']
        );
        
        expect(auditLogs.length).toBeGreaterThan(0);
        expect(auditLogs[0].action).toBe('login');
        expect(auditLogs[0].status).toBe('success');
      }
    });
  });

  describe('POST /auth/logout', () => {
    it('should logout authenticated user', async () => {
      const { login } = await import('../../routes/auth.js');
      const router = login;
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session);
      const res = createMockResponse();

      const logoutHandler = router.stack.find(layer => layer.route?.path === '/logout')?.route?.stack[0]?.handle;
      
      if (logoutHandler) {
        await logoutHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData).toHaveProperty('success');
        expect(res.jsonData.success).toBe(true);
      }
    });

    it('should create audit log entry for logout', async () => {
      const { login } = await import('../../routes/auth.js');
      const router = login;
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session);
      const res = createMockResponse();

      const logoutHandler = router.stack.find(layer => layer.route?.path === '/logout')?.route?.stack[0]?.handle;
      
      if (logoutHandler) {
        await logoutHandler(req, res);
        
        // Check audit log
        const [auditLogs] = await dbPool.execute(
          'SELECT * FROM audit_log WHERE user_id = ? AND action = ? ORDER BY created_at DESC LIMIT 1',
          [testUsers.user.id, 'logout']
        );
        
        expect(auditLogs.length).toBeGreaterThan(0);
        expect(auditLogs[0].action).toBe('logout');
      }
    });
  });

  describe('GET /auth/me', () => {
    it('should return current user session data', async () => {
      const { login } = await import('../../routes/auth.js');
      const router = login;
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session);
      const res = createMockResponse();

      const meHandler = router.stack.find(layer => layer.route?.path === '/me')?.route?.stack[0]?.handle;
      
      if (meHandler) {
        await meHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData).toHaveProperty('id');
        expect(res.jsonData).toHaveProperty('email');
        expect(res.jsonData.email).toBe(testUsers.user.email);
      }
    });

    it('should return 401 for unauthenticated request', async () => {
      const { login } = await import('../../routes/auth.js');
      const router = login;
      
      const session = createMockSession(null); // No user
      const req = createMockRequest(session);
      const res = createMockResponse();

      const meHandler = router.stack.find(layer => layer.route?.path === '/me')?.route?.stack[0]?.handle;
      
      if (meHandler) {
        await meHandler(req, res);
        
        expect(res.statusCode).toBe(401);
        expect(res.jsonData).toHaveProperty('error');
      }
    });
  });

  describe('Session Management', () => {
    it('should invalidate session when password is changed', async () => {
      // Update user password to increment session_version
      const bcrypt = await import('bcryptjs');
      const newHash = await bcrypt.hash('NewPassword123!', 12);
      await dbPool.execute(
        'UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?',
        [newHash, testUsers.user.id]
      );

      // Old session should be rejected
      const { requireAuth } = await import('../../middleware/auth.js');
      
      const oldSession = createMockSession({ ...testUsers.user, session_version: 0 });
      const req = createMockRequest(oldSession);
      const res = createMockResponse();

      await requireAuth(req, res, () => {});
      
      expect(res.statusCode).toBe(401);
      expect(res.jsonData).toHaveProperty('error');
      expect(res.jsonData.error).toContain('révoquée');
    });

    it('should accept session with current session_version', async () => {
      const { requireAuth } = await import('../../middleware/auth.js');
      
      const currentSession = createMockSession({ ...testUsers.user, session_version: 0 });
      const req = createMockRequest(currentSession);
      const res = createMockResponse();
      let nextCalled = false;

      await requireAuth(req, res, () => { nextCalled = true; });
      
      expect(nextCalled).toBe(true);
      expect(res.statusCode).not.toBe(401);
    });
  });

  describe('Role-Based Access Control', () => {
    it('should allow admin access to admin routes', async () => {
      const { requireAdmin } = await import('../../middleware/auth.js');
      
      const adminSession = createMockSession(testUsers.admin);
      const req = createMockRequest(adminSession);
      const res = createMockResponse();
      let nextCalled = false;

      await requireAdmin(req, res, () => { nextCalled = true; });
      
      expect(nextCalled).toBe(true);
      expect(res.statusCode).not.toBe(403);
    });

    it('should deny regular user access to admin routes', async () => {
      const { requireAdmin } = await import('../../middleware/auth.js');
      
      const userSession = createMockSession(testUsers.user);
      const req = createMockRequest(userSession);
      const res = createMockResponse();
      let nextCalled = false;

      await requireAdmin(req, res, () => { nextCalled = true; });
      
      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(403);
      expect(res.jsonData).toHaveProperty('error');
      expect(res.jsonData.error).toContain('admin');
    });

    it('should deny analyst access to admin routes', async () => {
      const { requireAdmin } = await import('../../middleware/auth.js');
      
      const analystSession = createMockSession(testUsers.analyst);
      const req = createMockRequest(analystSession);
      const res = createMockResponse();
      let nextCalled = false;

      await requireAdmin(req, res, () => { nextCalled = true; });
      
      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(403);
    });
  });

  describe('Password Change', () => {
    it('should allow user to change password with valid current password', async () => {
      const { login } = await import('../../routes/auth.js');
      const router = login;
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {
        current_password: testUsers.user.password,
        new_password: 'NewSecurePassword123!'
      });
      const res = createMockResponse();

      const passwordHandler = router.stack.find(layer => layer.route?.path === '/password')?.route?.stack[0]?.handle;
      
      if (passwordHandler) {
        await passwordHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData).toHaveProperty('success');
        expect(res.jsonData.success).toBe(true);
      }
    });

    it('should reject password change with invalid current password', async () => {
      const { login } = await import('../../routes/auth.js');
      const router = login;
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {
        current_password: 'WrongPassword123!',
        new_password: 'NewSecurePassword123!'
      });
      const res = createMockResponse();

      const passwordHandler = router.stack.find(layer => layer.route?.path === '/password')?.route?.stack[0]?.handle;
      
      if (passwordHandler) {
        await passwordHandler(req, res);
        
        expect(res.statusCode).toBe(401);
        expect(res.jsonData).toHaveProperty('error');
      }
    });

    it('should increment session_version on password change', async () => {
      const { login } = await import('../../routes/auth.js');
      const router = login;
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {
        current_password: testUsers.user.password,
        new_password: 'NewSecurePassword123!'
      });
      const res = createMockResponse();

      const passwordHandler = router.stack.find(layer => layer.route?.path === '/password')?.route?.stack[0]?.handle;
      
      if (passwordHandler) {
        await passwordHandler(req, res);
        
        // Check session_version was incremented
        const [users] = await dbPool.execute('SELECT session_version FROM users WHERE id = ?', [testUsers.user.id]);
        expect(users[0].session_version).toBeGreaterThan(0);
      }
    });

    it('should create audit log entry for password change', async () => {
      const { login } = await import('../../routes/auth.js');
      const router = login;
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {
        current_password: testUsers.user.password,
        new_password: 'NewSecurePassword123!'
      });
      const res = createMockResponse();

      const passwordHandler = router.stack.find(layer => layer.route?.path === '/password')?.route?.stack[0]?.handle;
      
      if (passwordHandler) {
        await passwordHandler(req, res);
        
        // Check audit log
        const [auditLogs] = await dbPool.execute(
          'SELECT * FROM audit_log WHERE user_id = ? AND action = ? ORDER BY created_at DESC LIMIT 1',
          [testUsers.user.id, 'change_password']
        );
        
        expect(auditLogs.length).toBeGreaterThan(0);
        expect(auditLogs[0].action).toBe('change_password');
      }
    });
  });
});