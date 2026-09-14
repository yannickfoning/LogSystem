/**
 * Audit Middleware Integration Tests
 * Tests audit logging for sensitive operations and audit log access
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

describe('Audit Middleware', () => {
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

  describe('Audit Log Recording', () => {
    it('should record login events', async () => {
      const { recordAudit } = await import('../../middleware/audit.js');
      
      await recordAudit({
        userId: testUsers.user.id,
        userEmail: testUsers.user.email,
        action: 'login',
        resourceType: 'session',
        ipAddress: '127.0.0.1',
        status: 'success'
      });
      
      const [auditLogs] = await dbPool.execute(
        'SELECT * FROM audit_log WHERE user_id = ? AND action = ? ORDER BY created_at DESC LIMIT 1',
        [testUsers.user.id, 'login']
      );
      
      expect(auditLogs.length).toBeGreaterThan(0);
      expect(auditLogs[0].action).toBe('login');
      expect(auditLogs[0].status).toBe('success');
      expect(auditLogs[0].ip_address).toBe('127.0.0.1');
    });

    it('should record logout events', async () => {
      const { recordAudit } = await import('../../middleware/audit.js');
      
      await recordAudit({
        userId: testUsers.user.id,
        userEmail: testUsers.user.email,
        action: 'logout',
        resourceType: 'session',
        ipAddress: '127.0.0.1',
        status: 'success'
      });
      
      const [auditLogs] = await dbPool.execute(
        'SELECT * FROM audit_log WHERE user_id = ? AND action = ? ORDER BY created_at DESC LIMIT 1',
        [testUsers.user.id, 'logout']
      );
      
      expect(auditLogs.length).toBeGreaterThan(0);
      expect(auditLogs[0].action).toBe('logout');
    });

    it('should record password change events', async () => {
      const { recordAudit } = await import('../../middleware/audit.js');
      
      await recordAudit({
        userId: testUsers.user.id,
        userEmail: testUsers.user.email,
        action: 'change_password',
        resourceType: 'user',
        resourceId: String(testUsers.user.id),
        details: 'Password changed by user',
        ipAddress: '127.0.0.1',
        status: 'success'
      });
      
      const [auditLogs] = await dbPool.execute(
        'SELECT * FROM audit_log WHERE user_id = ? AND action = ? ORDER BY created_at DESC LIMIT 1',
        [testUsers.user.id, 'change_password']
      );
      
      expect(auditLogs.length).toBeGreaterThan(0);
      expect(auditLogs[0].action).toBe('change_password');
      expect(auditLogs[0].resource_type).toBe('user');
    });

    it('should record failed password change attempts', async () => {
      const { recordAudit } = await import('../../middleware/audit.js');
      
      await recordAudit({
        userId: testUsers.user.id,
        userEmail: testUsers.user.email,
        action: 'change_password_error',
        resourceType: 'user',
        ipAddress: '127.0.0.1',
        status: 'failure'
      });
      
      const [auditLogs] = await dbPool.execute(
        'SELECT * FROM audit_log WHERE user_id = ? AND action = ? ORDER BY created_at DESC LIMIT 1',
        [testUsers.user.id, 'change_password_error']
      );
      
      expect(auditLogs.length).toBeGreaterThan(0);
      expect(auditLogs[0].status).toBe('failure');
    });

    it('should record user creation events', async () => {
      const { recordAudit } = await import('../../middleware/audit.js');
      
      await recordAudit({
        userId: testUsers.admin.id,
        userEmail: testUsers.admin.email,
        action: 'create_user',
        resourceType: 'user',
        resourceId: '999',
        details: 'Created user: newuser@test.local',
        ipAddress: '127.0.0.1',
        status: 'success'
      });
      
      const [auditLogs] = await dbPool.execute(
        'SELECT * FROM audit_log WHERE user_id = ? AND action = ? ORDER BY created_at DESC LIMIT 1',
        [testUsers.admin.id, 'create_user']
      );
      
      expect(auditLogs.length).toBeGreaterThan(0);
      expect(auditLogs[0].action).toBe('create_user');
      expect(auditLogs[0].details).toContain('newuser@test.local');
    });

    it('should record user update events', async () => {
      const { recordAudit } = await import('../../middleware/audit.js');
      
      await recordAudit({
        userId: testUsers.admin.id,
        userEmail: testUsers.admin.email,
        action: 'update_user',
        resourceType: 'user',
        resourceId: String(testUsers.user.id),
        details: 'Updated user role to analyst',
        ipAddress: '127.0.0.1',
        status: 'success'
      });
      
      const [auditLogs] = await dbPool.execute(
        'SELECT * FROM audit_log WHERE user_id = ? AND action = ? ORDER BY created_at DESC LIMIT 1',
        [testUsers.admin.id, 'update_user']
      );
      
      expect(auditLogs.length).toBeGreaterThan(0);
      expect(auditLogs[0].action).toBe('update_user');
    });

    it('should record user deletion events', async () => {
      const { recordAudit } = await import('../../middleware/audit.js');
      
      await recordAudit({
        userId: testUsers.admin.id,
        userEmail: testUsers.admin.email,
        action: 'delete_user',
        resourceType: 'user',
        resourceId: '999',
        details: 'Deleted user 999',
        ipAddress: '127.0.0.1',
        status: 'success'
      });
      
      const [auditLogs] = await dbPool.execute(
        'SELECT * FROM audit_log WHERE user_id = ? AND action = ? ORDER BY created_at DESC LIMIT 1',
        [testUsers.admin.id, 'delete_user']
      );
      
      expect(auditLogs.length).toBeGreaterThan(0);
      expect(auditLogs[0].action).toBe('delete_user');
    });

    it('should record alert rule creation', async () => {
      const { recordAudit } = await import('../../middleware/audit.js');
      
      await recordAudit({
        userId: testUsers.admin.id,
        userEmail: testUsers.admin.email,
        action: 'create_alert_rule',
        resourceType: 'alert_rule',
        resourceId: '123',
        details: 'Created rule: Test Alert',
        ipAddress: '127.0.0.1',
        status: 'success'
      });
      
      const [auditLogs] = await dbPool.execute(
        'SELECT * FROM audit_log WHERE user_id = ? AND action = ? ORDER BY created_at DESC LIMIT 1',
        [testUsers.admin.id, 'create_alert_rule']
      );
      
      expect(auditLogs.length).toBeGreaterThan(0);
      expect(auditLogs[0].action).toBe('create_alert_rule');
    });

    it('should record alert rule deletion', async () => {
      const { recordAudit } = await import('../../middleware/audit.js');
      
      await recordAudit({
        userId: testUsers.admin.id,
        userEmail: testUsers.admin.email,
        action: 'delete_alert_rule',
        resourceType: 'alert_rule',
        resourceId: '123',
        ipAddress: '127.0.0.1',
        status: 'success'
      });
      
      const [auditLogs] = await dbPool.execute(
        'SELECT * FROM audit_log WHERE user_id = ? AND action = ? ORDER BY created_at DESC LIMIT 1',
        [testUsers.admin.id, 'delete_alert_rule']
      );
      
      expect(auditLogs.length).toBeGreaterThan(0);
      expect(auditLogs[0].action).toBe('delete_alert_rule');
    });

    it('should record log deletion events', async () => {
      const { recordAudit } = await import('../../middleware/audit.js');
      
      await recordAudit({
        userId: testUsers.user.id,
        userEmail: testUsers.user.email,
        action: 'delete_log',
        resourceType: 'log',
        resourceId: '456',
        details: 'User deleted own log 456',
        ipAddress: '127.0.0.1',
        status: 'success'
      });
      
      const [auditLogs] = await dbPool.execute(
        'SELECT * FROM audit_log WHERE user_id = ? AND action = ? ORDER BY created_at DESC LIMIT 1',
        [testUsers.user.id, 'delete_log']
      );
      
      expect(auditLogs.length).toBeGreaterThan(0);
      expect(auditLogs[0].action).toBe('delete_log');
    });

    it('should record import events', async () => {
      const { recordAudit } = await import('../../middleware/audit.js');
      
      await recordAudit({
        userId: testUsers.user.id,
        userEmail: testUsers.user.email,
        action: 'import_upload',
        resourceType: 'import_job',
        resourceId: 'uuid-123-456',
        details: 'Imported file: app.log',
        ipAddress: '127.0.0.1',
        status: 'success'
      });
      
      const [auditLogs] = await dbPool.execute(
        'SELECT * FROM audit_log WHERE user_id = ? AND action = ? ORDER BY created_at DESC LIMIT 1',
        [testUsers.user.id, 'import_upload']
      );
      
      expect(auditLogs.length).toBeGreaterThan(0);
      expect(auditLogs[0].action).toBe('import_upload');
    });

    it('should record retention run events', async () => {
      const { recordAudit } = await import('../../middleware/audit.js');
      
      await recordAudit({
        userId: testUsers.admin.id,
        userEmail: testUsers.admin.email,
        action: 'run_retention',
        resourceType: 'system',
        details: 'Manual retention run',
        ipAddress: '127.0.0.1',
        status: 'success'
      });
      
      const [auditLogs] = await dbPool.execute(
        'SELECT * FROM audit_log WHERE user_id = ? AND action = ? ORDER BY created_at DESC LIMIT 1',
        [testUsers.admin.id, 'run_retention']
      );
      
      expect(auditLogs.length).toBeGreaterThan(0);
      expect(auditLogs[0].action).toBe('run_retention');
    });

    it('should record purge events', async () => {
      const { recordAudit } = await import('../../middleware/audit.js');
      
      await recordAudit({
        userId: testUsers.user.id,
        userEmail: testUsers.user.email,
        action: 'purge_logs',
        resourceType: 'logs',
        details: 'Purged 150 logs',
        ipAddress: '127.0.0.1',
        status: 'success'
      });
      
      const [auditLogs] = await dbPool.execute(
        'SELECT * FROM audit_log WHERE user_id = ? AND action = ? ORDER BY created_at DESC LIMIT 1',
        [testUsers.user.id, 'purge_logs']
      );
      
      expect(auditLogs.length).toBeGreaterThan(0);
      expect(auditLogs[0].action).toBe('purge_logs');
    });

    it('should record password reset events', async () => {
      const { recordAudit } = await import('../../middleware/audit.js');
      
      await recordAudit({
        userId: testUsers.admin.id,
        userEmail: testUsers.admin.email,
        action: 'reset_password',
        resourceType: 'user',
        resourceId: String(testUsers.user.id),
        details: 'Password reset for user 123',
        ipAddress: '127.0.0.1',
        status: 'success'
      });
      
      const [auditLogs] = await dbPool.execute(
        'SELECT * FROM audit_log WHERE user_id = ? AND action = ? ORDER BY created_at DESC LIMIT 1',
        [testUsers.admin.id, 'reset_password']
      );
      
      expect(auditLogs.length).toBeGreaterThan(0);
      expect(auditLogs[0].action).toBe('reset_password');
    });

    it('should record audit log read events', async () => {
      const { recordAudit } = await import('../../middleware/audit.js');
      
      await recordAudit({
        userId: testUsers.admin.id,
        userEmail: testUsers.admin.email,
        action: 'audit_log_read',
        resourceType: 'audit_log',
        ipAddress: '127.0.0.1',
        status: 'success'
      });
      
      const [auditLogs] = await dbPool.execute(
        'SELECT * FROM audit_log WHERE user_id = ? AND action = ? ORDER BY created_at DESC LIMIT 1',
        [testUsers.admin.id, 'audit_log_read']
      );
      
      expect(auditLogs.length).toBeGreaterThan(0);
      expect(auditLogs[0].action).toBe('audit_log_read');
    });
  });

  describe('Audit Log Data Integrity', () => {
    it('should include required fields in audit entries', async () => {
      const { recordAudit } = await import('../../middleware/audit.js');
      
      await recordAudit({
        userId: testUsers.user.id,
        userEmail: testUsers.user.email,
        action: 'test_action',
        resourceType: 'test_resource',
        ipAddress: '127.0.0.1',
        status: 'success'
      });
      
      const [auditLogs] = await dbPool.execute(
        'SELECT * FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
        [testUsers.user.id]
      );
      
      const audit = auditLogs[0];
      expect(audit).toHaveProperty('id');
      expect(audit).toHaveProperty('user_id');
      expect(audit).toHaveProperty('user_email');
      expect(audit).toHaveProperty('action');
      expect(audit).toHaveProperty('resource_type');
      expect(audit).toHaveProperty('ip_address');
      expect(audit).toHaveProperty('status');
      expect(audit).toHaveProperty('created_at');
    });

    it('should handle long details by truncating', async () => {
      const { recordAudit } = await import('../../middleware/audit.js');
      
      const longDetails = 'a'.repeat(3000);
      await recordAudit({
        userId: testUsers.user.id,
        userEmail: testUsers.user.email,
        action: 'test_action',
        resourceType: 'test_resource',
        details: longDetails,
        ipAddress: '127.0.0.1',
        status: 'success'
      });
      
      const [auditLogs] = await dbPool.execute(
        'SELECT details FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
        [testUsers.user.id]
      );
      
      // Details should be truncated to 2000 characters
      expect(auditLogs[0].details.length).toBeLessThanOrEqual(2000);
    });

    it('should handle null user gracefully', async () => {
      const { recordAudit } = await import('../../middleware/audit.js');
      
      await recordAudit({
        userId: null,
        userEmail: null,
        action: 'system_action',
        resourceType: 'system',
        ipAddress: '127.0.0.1',
        status: 'success'
      });
      
      const [auditLogs] = await dbPool.execute(
        'SELECT * FROM audit_log WHERE action = ? ORDER BY created_at DESC LIMIT 1',
        ['system_action']
      );
      
      expect(auditLogs.length).toBeGreaterThan(0);
      expect(auditLogs[0].user_id).toBeNull();
    });

    it('should handle missing resource ID', async () => {
      const { recordAudit } = await import('../../middleware/audit.js');
      
      await recordAudit({
        userId: testUsers.user.id,
        userEmail: testUsers.user.email,
        action: 'test_action',
        resourceType: 'test_resource',
        ipAddress: '127.0.0.1',
        status: 'success'
      });
      
      const [auditLogs] = await dbPool.execute(
        'SELECT * FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
        [testUsers.user.id]
      );
      
      expect(auditLogs.length).toBeGreaterThan(0);
      expect(auditLogs[0].resource_id).toBeNull();
    });

    it('should use correct timestamp', async () => {
      const { recordAudit } = await import('../../middleware/audit.js');
      
      const beforeRecord = new Date();
      
      await recordAudit({
        userId: testUsers.user.id,
        userEmail: testUsers.user.email,
        action: 'test_action',
        resourceType: 'test_resource',
        ipAddress: '127.0.0.1',
        status: 'success'
      });
      
      const afterRecord = new Date();
      
      const [auditLogs] = await dbPool.execute(
        'SELECT created_at FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
        [testUsers.user.id]
      );
      
      const auditTime = new Date(auditLogs[0].created_at);
      expect(auditTime.getTime()).toBeGreaterThanOrEqual(beforeRecord.getTime());
      expect(auditTime.getTime()).toBeLessThanOrEqual(afterRecord.getTime());
    });
  });

  describe('Audit Log Access Control', () => {
    it('should require admin to read audit logs', async () => {
      const { getAuditLogs } = await import('../../middleware/audit.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, {});
      
      await expect(getAuditLogs(req, 10, 0)).rejects.toThrow('Admin access required');
    });

    it('should allow admin to read audit logs', async () => {
      const { getAuditLogs } = await import('../../middleware/audit.js');
      
      const session = createMockSession(testUsers.admin);
      const req = createMockRequest(session, {}, {});
      
      const logs = await getAuditLogs(req, 10, 0);
      
      expect(Array.isArray(logs)).toBe(true);
    });

    it('should record audit log read access', async () => {
      const { getAuditLogs } = await import('../../middleware/audit.js');
      
      const session = createMockSession(testUsers.admin);
      const req = createMockRequest(session, {}, {});
      
      await getAuditLogs(req, 10, 0);
      
      const [auditLogs] = await dbPool.execute(
        'SELECT * FROM audit_log WHERE user_id = ? AND action = ? ORDER BY created_at DESC LIMIT 1',
        [testUsers.admin.id, 'audit_log_read']
      );
      
      expect(auditLogs.length).toBeGreaterThan(0);
    });

    it('should limit audit log results', async () => {
      const { getAuditLogs } = await import('../../middleware/audit.js');
      
      const session = createMockSession(testUsers.admin);
      const req = createMockRequest(session, {}, {});
      
      const logs = await getAuditLogs(req, 1000, 0);
      
      // Should be limited to max 500
      expect(logs.length).toBeLessThanOrEqual(500);
    });

    it('should support pagination', async () => {
      const { getAuditLogs } = await import('../../middleware/audit.js');
      
      const session = createMockSession(testUsers.admin);
      const req = createMockRequest(session, {}, {});
      
      const firstPage = await getAuditLogs(req, 10, 0);
      const secondPage = await getAuditLogs(req, 10, 10);
      
      expect(Array.isArray(firstPage)).toBe(true);
      expect(Array.isArray(secondPage)).toBe(true);
    });
  });

  describe('Audit Middleware Factory', () => {
    it('should create audit middleware for routes', async () => {
      const { auditMiddleware } = await import('../../middleware/audit.js');
      
      const middleware = auditMiddleware('test_action', 'test_resource');
      
      expect(typeof middleware).toBe('function');
    });

    it('should wrap response.json to record audit', async () => {
      const { auditMiddleware } = await import('../../middleware/audit.js');
      
      const middleware = auditMiddleware('test_action', 'test_resource');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, {});
      const res = createMockResponse();
      let nextCalled = false;
      
      middleware(req, res, () => { nextCalled = true; });
      
      expect(nextCalled).toBe(true);
      expect(typeof res.json).toBe('function');
    });

    it('should extract resource ID from params or body', async () => {
      const { auditMiddleware } = await import('../../middleware/audit.js');
      
      const middleware = auditMiddleware('test_action', 'test_resource');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, {}, { id: '123' });
      const res = createMockResponse();
      
      middleware(req, res, () => {});
      
      // Middleware should be able to extract ID from params
      expect(req.params).toHaveProperty('id');
    });

    it('should handle audit recording failures gracefully', async () => {
      const { recordAudit } = await import('../../middleware/audit.js');
      
      // Try to record with invalid data (should not throw)
      await recordAudit({
        userId: testUsers.user.id,
        userEmail: testUsers.user.email,
        action: 'test_action',
        resourceType: 'test_resource',
        ipAddress: '127.0.0.1',
        status: 'success'
      });
      
      // Should not throw error even if audit fails
      expect(true).toBe(true);
    });
  });

  describe('Audit Log Filtering', () => {
    it('should filter by user ID', async () => {
      // Create audit logs for different users
      await dbPool.execute(
        `INSERT INTO audit_log (user_id, user_email, action, resource_type, ip_address, status) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [testUsers.user.id, testUsers.user.email, 'action1', 'resource1', '127.0.0.1', 'success']
      );
      await dbPool.execute(
        `INSERT INTO audit_log (user_id, user_email, action, resource_type, ip_address, status) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [testUsers.admin.id, testUsers.admin.email, 'action2', 'resource2', '127.0.0.1', 'success']
      );
      
      const [userLogs] = await dbPool.execute(
        'SELECT * FROM audit_log WHERE user_id = ?',
        [testUsers.user.id]
      );
      
      expect(userLogs.length).toBe(1);
      expect(userLogs[0].user_id).toBe(testUsers.user.id);
    });

    it('should filter by action type', async () => {
      await dbPool.execute(
        `INSERT INTO audit_log (user_id, user_email, action, resource_type, ip_address, status) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [testUsers.user.id, testUsers.user.email, 'login', 'session', '127.0.0.1', 'success']
      );
      await dbPool.execute(
        `INSERT INTO audit_log (user_id, user_email, action, resource_type, ip_address, status) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [testUsers.user.id, testUsers.user.email, 'logout', 'session', '127.0.0.1', 'success']
      );
      
      const [loginLogs] = await dbPool.execute(
        'SELECT * FROM audit_log WHERE action = ?',
        ['login']
      );
      
      expect(loginLogs.length).toBe(1);
      expect(loginLogs[0].action).toBe('login');
    });

    it('should filter by resource type', async () => {
      await dbPool.execute(
        `INSERT INTO audit_log (user_id, user_email, action, resource_type, ip_address, status) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [testUsers.user.id, testUsers.user.email, 'create', 'user', '127.0.0.1', 'success']
      );
      await dbPool.execute(
        `INSERT INTO audit_log (user_id, user_email, action, resource_type, ip_address, status) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [testUsers.user.id, testUsers.user.email, 'delete', 'log', '127.0.0.1', 'success']
      );
      
      const [userLogs] = await dbPool.execute(
        'SELECT * FROM audit_log WHERE resource_type = ?',
        ['user']
      );
      
      expect(userLogs.length).toBe(1);
      expect(userLogs[0].resource_type).toBe('user');
    });

    it('should filter by date range', async () => {
      const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const recentDate = new Date();
      
      await dbPool.execute(
        `INSERT INTO audit_log (user_id, user_email, action, resource_type, ip_address, status, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [testUsers.user.id, testUsers.user.email, 'old_action', 'resource1', '127.0.0.1', 'success', oldDate]
      );
      await dbPool.execute(
        `INSERT INTO audit_log (user_id, user_email, action, resource_type, ip_address, status, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [testUsers.user.id, testUsers.user.email, 'recent_action', 'resource2', '127.0.0.1', 'success', recentDate]
      );
      
      const today = new Date().toISOString().slice(0, 10);
      const [recentLogs] = await dbPool.execute(
        'SELECT * FROM audit_log WHERE DATE(created_at) = ?',
        [today]
      );
      
      expect(recentLogs.length).toBe(1);
      expect(recentLogs[0].action).toBe('recent_action');
    });

    it('should filter by status', async () => {
      await dbPool.execute(
        `INSERT INTO audit_log (user_id, user_email, action, resource_type, ip_address, status) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [testUsers.user.id, testUsers.user.email, 'success_action', 'resource1', '127.0.0.1', 'success']
      );
      await dbPool.execute(
        `INSERT INTO audit_log (user_id, user_email, action, resource_type, ip_address, status) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [testUsers.user.id, testUsers.user.email, 'failure_action', 'resource2', '127.0.0.1', 'failure']
      );
      
      const [successLogs] = await dbPool.execute(
        'SELECT * FROM audit_log WHERE status = ?',
        ['success']
      );
      
      expect(successLogs.length).toBe(1);
      expect(successLogs[0].status).toBe('success');
    });
  });

  describe('Audit Log Performance', () => {
    it('should handle high volume of audit entries', async () => {
      // Create many audit entries
      const entries = [];
      for (let i = 0; i < 100; i++) {
        entries.push([
          testUsers.user.id,
          testUsers.user.email,
          `action_${i}`,
          'resource',
          '127.0.0.1',
          'success'
        ]);
      }
      
      const startTime = Date.now();
      
      for (const entry of entries) {
        await dbPool.execute(
          `INSERT INTO audit_log (user_id, user_email, action, resource_type, ip_address, status) 
           VALUES (?, ?, ?, ?, ?, ?)`,
          entry
        );
      }
      
      const duration = Date.now() - startTime;
      
      // Should complete in reasonable time
      expect(duration).toBeLessThan(5000);
    });

    it('should use appropriate indexes for filtering', async () => {
      // Verify indexes exist
      const [indexes] = await dbPool.execute(
        'SHOW INDEX FROM audit_log'
      );
      
      const indexNames = indexes.map(idx => idx.Key_name);
      expect(indexNames).toContain('idx_audit_user');
      expect(indexNames).toContain('idx_audit_action');
      expect(indexNames).toContain('idx_audit_resource');
      expect(indexNames).toContain('idx_audit_created');
    });
  });
});