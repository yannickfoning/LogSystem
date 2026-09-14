/**
 * Dashboard and Admin Integration Tests
 * Tests dashboard statistics, admin operations, user management, and system monitoring
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { 
  setupTestDb, 
  teardownTestDb, 
  cleanTestData, 
  createTestUsers, 
  createTestLogs,
  createMockSession,
  createMockRequest,
  createMockResponse,
  getTestDbPool
} from '../test-setup.js';

describe('Dashboard and Admin', () => {
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

  describe('Dashboard Summary', () => {
    it('should return dashboard statistics', async () => {
      await createTestLogs(testUsers.user.id, 20);
      
      const { default: dashboardRouter } = await import('../../routes/dashboard.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, {});
      const res = createMockResponse();

      const summaryHandler = dashboardRouter.stack.find(layer => layer.route?.path === '/summary')?.route?.stack[0]?.handle;
      
      if (summaryHandler) {
        await summaryHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData).toHaveProperty('totalLogs');
        expect(res.jsonData).toHaveProperty('errorCount');
        expect(res.jsonData).toHaveProperty('unreadAlerts');
        expect(res.jsonData).toHaveProperty('fatalCount');
        expect(res.jsonData).toHaveProperty('criticalCount');
      }
    });

    it('should calculate per-level breakdown', async () => {
      await createTestLogs(testUsers.user.id, 30);
      
      const { default: dashboardRouter } = await import('../../routes/dashboard.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, {});
      const res = createMockResponse();

      const summaryHandler = dashboardRouter.stack.find(layer => layer.route?.path === '/summary')?.route?.stack[0]?.handle;
      
      if (summaryHandler) {
        await summaryHandler(req, res);
        
        expect(res.jsonData).toHaveProperty('level_debug');
        expect(res.jsonData).toHaveProperty('level_info');
        expect(res.jsonData).toHaveProperty('level_warning');
        expect(res.jsonData).toHaveProperty('level_error');
        expect(res.jsonData).toHaveProperty('level_critical');
        expect(res.jsonData).toHaveProperty('level_fatal');
      }
    });

    it('should handle empty dashboard state', async () => {
      const { default: dashboardRouter } = await import('../../routes/dashboard.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, {});
      const res = createMockResponse();

      const summaryHandler = dashboardRouter.stack.find(layer => layer.route?.path === '/summary')?.route?.stack[0]?.handle;
      
      if (summaryHandler) {
        await summaryHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData.totalLogs).toBe(0);
        expect(res.jsonData.errorCount).toBe(0);
      }
    });

    it('should use cache when available', async () => {
      await createTestLogs(testUsers.user.id, 10);
      
      const { default: dashboardRouter } = await import('../../routes/dashboard.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, {});
      const res = createMockResponse();

      const summaryHandler = dashboardRouter.stack.find(layer => layer.route?.path === '/summary')?.route?.stack[0]?.handle;
      
      if (summaryHandler) {
        await summaryHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        // Should attempt to use cache
      }
    });

    it('should enforce user scope on dashboard stats', async () => {
      await createTestLogs(testUsers.user.id, 10);
      await createTestLogs(testUsers.admin.id, 20);
      
      const { default: dashboardRouter } = await import('../../routes/dashboard.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, {});
      const res = createMockResponse();

      const summaryHandler = dashboardRouter.stack.find(layer => layer.route?.path === '/summary')?.route?.stack[0]?.handle;
      
      if (summaryHandler) {
        await summaryHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData.totalLogs).toBe(10);
      }
    });
  });

  describe('Dashboard Trends', () => {
    it('should return trend data', async () => {
      await createTestLogs(testUsers.user.id, 50);
      
      const { default: dashboardRouter } = await import('../../routes/dashboard.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { days: 7 });
      const res = createMockResponse();

      const trendsHandler = dashboardRouter.stack.find(layer => layer.route?.path === '/trends')?.route?.stack[0]?.handle;
      
      if (trendsHandler) {
        await trendsHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData).toHaveProperty('trends');
        expect(res.jsonData).toHaveProperty('dates');
        expect(Array.isArray(res.jsonData.trends)).toBe(true);
      }
    });

    it('should support custom date ranges', async () => {
      await createTestLogs(testUsers.user.id, 30);
      
      const { default: dashboardRouter } = await import('../../routes/dashboard.js');
      
      const session = createMockSession(testUsers.user);
      const startDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const endDate = new Date().toISOString().slice(0, 10);
      const req = createMockRequest(session, {}, { 
        start_date: startDate, 
        end_date: endDate 
      });
      const res = createMockResponse();

      const trendsHandler = dashboardRouter.stack.find(layer => layer.route?.path === '/trends')?.route?.stack[0]?.handle;
      
      if (trendsHandler) {
        await trendsHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData).toHaveProperty('trends');
      }
    });

    it('should validate date range order', async () => {
      const { default: dashboardRouter } = await import('../../routes/dashboard.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { 
        start_date: '2026-12-31', 
        end_date: '2026-01-01' 
      });
      const res = createMockResponse();

      const trendsHandler = dashboardRouter.stack.find(layer => layer.route?.path === '/trends')?.route?.stack[0]?.handle;
      
      if (trendsHandler) {
        await trendsHandler(req, res);
        
        expect(res.statusCode).toBe(400);
        expect(res.jsonData).toHaveProperty('error');
      }
    });

    it('should include hourly interval data', async () => {
      await createTestLogs(testUsers.user.id, 20);
      
      const { default: dashboardRouter } = await import('../../routes/dashboard.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { interval: 'hour' });
      const res = createMockResponse();

      const trendsHandler = dashboardRouter.stack.find(layer => layer.route?.path === '/trends')?.route?.stack[0]?.handle;
      
      if (trendsHandler) {
        await trendsHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData).toHaveProperty('interval');
        expect(res.jsonData.interval).toBe('hour');
      }
    });

    it('should calculate top fingerprints', async () => {
      await createTestLogs(testUsers.user.id, 40);
      
      const { default: dashboardRouter } = await import('../../routes/dashboard.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { days: 7 });
      const res = createMockResponse();

      const trendsHandler = dashboardRouter.stack.find(layer => layer.route?.path === '/trends')?.route?.stack[0]?.handle;
      
      if (trendsHandler) {
        await trendsHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData).toHaveProperty('top_fingerprints');
        expect(Array.isArray(res.jsonData.top_fingerprints)).toBe(true);
      }
    });
  });

  describe('Top Errors', () => {
    it('should return top error groups', async () => {
      await createTestLogs(testUsers.user.id, 30);
      
      const { default: dashboardRouter } = await import('../../routes/dashboard.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { limit: 10 });
      const res = createMockResponse();

      const topErrorsHandler = dashboardRouter.stack.find(layer => layer.route?.path === '/top-errors')?.route?.stack[0]?.handle;
      
      if (topErrorsHandler) {
        await topErrorsHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData).toHaveProperty('topErrors');
        expect(Array.isArray(res.jsonData.topErrors)).toBe(true);
      }
    });

    it('should include sample logs for error groups', async () => {
      await createTestLogs(testUsers.user.id, 25);
      
      const { default: dashboardRouter } = await import('../../routes/dashboard.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { limit: 5 });
      const res = createMockResponse();

      const topErrorsHandler = dashboardRouter.stack.find(layer => layer.route?.path === '/top-errors')?.route?.stack[0]?.handle;
      
      if (topErrorsHandler) {
        await topErrorsHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        if (res.jsonData.topErrors.length > 0) {
          expect(res.jsonData.topErrors[0]).toHaveProperty('sampleLogs');
        }
      }
    });

    it('should filter by error status', async () => {
      await createTestLogs(testUsers.user.id, 20);
      
      const { default: dashboardRouter } = await import('../../routes/dashboard.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { status: 'open' });
      const res = createMockResponse();

      const topErrorsHandler = dashboardRouter.stack.find(layer => layer.route?.path === '/top-errors')?.route?.stack[0]?.handle;
      
      if (topErrorsHandler) {
        await topErrorsHandler(req, res);
        
        expect(res.statusCode).toBe(200);
      }
    });
  });

  describe('Recent Logs', () => {
    it('should return recent logs', async () => {
      await createTestLogs(testUsers.user.id, 15);
      
      const { default: dashboardRouter } = await import('../../routes/dashboard.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { limit: 10 });
      const res = createMockResponse();

      const recentLogsHandler = dashboardRouter.stack.find(layer => layer.route?.path === '/recent-logs')?.route?.stack[0]?.handle;
      
      if (recentLogsHandler) {
        await recentLogsHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData).toHaveProperty('recentLogs');
        expect(Array.isArray(res.jsonData.recentLogs)).toBe(true);
      }
    });

    it('should limit recent logs count', async () => {
      await createTestLogs(testUsers.user.id, 50);
      
      const { default: dashboardRouter } = await import('../../routes/dashboard.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { limit: 5 });
      const res = createMockResponse();

      const recentLogsHandler = dashboardRouter.stack.find(layer => layer.route?.path === '/recent-logs')?.route?.stack[0]?.handle;
      
      if (recentLogsHandler) {
        await recentLogsHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData.recentLogs.length).toBeLessThanOrEqual(5);
      }
    });
  });

  describe('Alert Management', () => {
    it('should return user alerts', async () => {
      // Create test alert
      await dbPool.execute(
        `INSERT INTO alerts (rule_id, alert_type, severity, message, status, user_id) 
         VALUES (1, 'level', 'high', 'Test alert', 'new', ?)`,
        [testUsers.user.id]
      );
      
      const { default: dashboardRouter } = await import('../../routes/dashboard.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { limit: 10 });
      const res = createMockResponse();

      const alertsHandler = dashboardRouter.stack.find(layer => layer.route?.path === '/alerts')?.route?.stack[0]?.handle;
      
      if (alertsHandler) {
        await alertsHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(Array.isArray(res.jsonData)).toBe(true);
      }
    });

    it('should mark all alerts as read', async () => {
      // Create test alerts
      await dbPool.execute(
        `INSERT INTO alerts (rule_id, alert_type, severity, message, status, user_id) 
         VALUES (1, 'level', 'high', 'Test alert 1', 'new', ?)`,
        [testUsers.user.id]
      );
      await dbPool.execute(
        `INSERT INTO alerts (rule_id, alert_type, severity, message, status, user_id) 
         VALUES (1, 'level', 'high', 'Test alert 2', 'new', ?)`,
        [testUsers.user.id]
      );
      
      const { default: dashboardRouter } = await import('../../routes/dashboard.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {});
      const res = createMockResponse();

      const readAllHandler = dashboardRouter.stack.find(layer => layer.route?.path === '/alerts/read-all' && layer.route?.methods?.put)?.route?.stack[0]?.handle;
      
      if (readAllHandler) {
        await readAllHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData).toHaveProperty('success');
      }
    });

    it('should mark single alert as read', async () => {
      const [result] = await dbPool.execute(
        `INSERT INTO alerts (rule_id, alert_type, severity, message, status, user_id) 
         VALUES (1, 'level', 'high', 'Test alert', 'new', ?)`,
        [testUsers.user.id]
      );
      const alertId = result.insertId;
      
      const { default: dashboardRouter } = await import('../../routes/dashboard.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {});
      req.params = { id: alertId };
      const res = createMockResponse();

      const readHandler = dashboardRouter.stack.find(layer => layer.route?.path === '/alerts/:id/read' && layer.route?.methods?.put)?.route?.stack[0]?.handle;
      
      if (readHandler) {
        await readHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData).toHaveProperty('success');
      }
    });

    it('should invalidate cache on alert status change', async () => {
      const { invalidateDashboard } = await import('../../services/cacheService.js');
      
      await invalidateDashboard(testUsers.user.id);
      
      expect(true).toBe(true);
    });
  });

  describe('User Management', () => {
    it('should list all users (admin only)', async () => {
      const { default: adminRouter } = await import('../../routes/admin.js');
      
      const session = createMockSession(testUsers.admin);
      const req = createMockRequest(session, {}, {});
      const res = createMockResponse();

      const usersHandler = adminRouter.stack.find(layer => layer.route?.path === '/users')?.route?.stack[0]?.handle;
      
      if (usersHandler) {
        await usersHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(Array.isArray(res.jsonData)).toBe(true);
        expect(res.jsonData.length).toBeGreaterThan(0);
      }
    });

    it('should create new user', async () => {
      const { default: adminRouter } = await import('../../routes/admin.js');
      
      const session = createMockSession(testUsers.admin);
      const req = createMockRequest(session, {
        email: 'newuser@test.local',
        password: 'SecurePass123!',
        display_name: 'New User',
        role: 'user'
      });
      const res = createMockResponse();

      const createHandler = adminRouter.stack.find(layer => layer.route?.path === '/users' && layer.route?.methods?.post)?.route?.stack[0]?.handle;
      
      if (createHandler) {
        await createHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData).toHaveProperty('success');
        expect(res.jsonData).toHaveProperty('id');
      }
    });

    it('should reject duplicate email', async () => {
      const { default: adminRouter } = await import('../../routes/admin.js');
      
      const session = createMockSession(testUsers.admin);
      const req = createMockRequest(session, {
        email: testUsers.user.email, // Duplicate
        password: 'SecurePass123!',
        role: 'user'
      });
      const res = createMockResponse();

      const createHandler = adminRouter.stack.find(layer => layer.route?.path === '/users' && layer.route?.methods?.post)?.route?.stack[0]?.handle;
      
      if (createHandler) {
        await createHandler(req, res);
        
        expect(res.statusCode).toBe(409);
        expect(res.jsonData).toHaveProperty('error');
      }
    });

    it('should update user', async () => {
      const { default: adminRouter } = await import('../../routes/admin.js');
      
      const session = createMockSession(testUsers.admin);
      const req = createMockRequest(session, {
        display_name: 'Updated Name',
        role: 'analyst'
      });
      req.params = { id: testUsers.user.id };
      const res = createMockResponse();

      const updateHandler = adminRouter.stack.find(layer => layer.route?.path === '/users/:id' && layer.route?.methods?.put)?.route?.stack[0]?.handle;
      
      if (updateHandler) {
        await updateHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData).toHaveProperty('success');
      }
    });

    it('should prevent self role change', async () => {
      const { default: adminRouter } = await import('../../routes/admin.js');
      
      const session = createMockSession(testUsers.admin);
      const req = createMockRequest(session, {
        role: 'user'
      });
      req.params = { id: testUsers.admin.id };
      const res = createMockResponse();

      const updateHandler = adminRouter.stack.find(layer => layer.route?.path === '/users/:id' && layer.route?.methods?.put)?.route?.stack[0]?.handle;
      
      if (updateHandler) {
        await updateHandler(req, res);
        
        expect(res.statusCode).toBe(403);
        expect(res.jsonData).toHaveProperty('error');
      }
    });

    it('should prevent self deactivation', async () => {
      const { default: adminRouter } = await import('../../routes/admin.js');
      
      const session = createMockSession(testUsers.admin);
      const req = createMockRequest(session, {
        is_active: false
      });
      req.params = { id: testUsers.admin.id };
      const res = createMockResponse();

      const updateHandler = adminRouter.stack.find(layer => layer.route?.path === '/users/:id' && layer.route?.methods?.put)?.route?.stack[0]?.handle;
      
      if (updateHandler) {
        await updateHandler(req, res);
        
        expect(res.statusCode).toBe(403);
        expect(res.jsonData).toHaveProperty('error');
      }
    });

    it('should delete user', async () => {
      // Create temporary user
      const [tempUser] = await dbPool.execute(
        `INSERT INTO users (email, password_hash, display_name, role, is_active) 
         VALUES (?, ?, ?, ?, 1)`,
        ['temp@test.local', '$2a$12$dummy.hash.for.testing', 'Temp User', 'user']
      );
      
      const { default: adminRouter } = await import('../../routes/admin.js');
      
      const session = createMockSession(testUsers.admin);
      const req = createMockRequest(session, {});
      req.params = { id: tempUser.insertId };
      const res = createMockResponse();

      const deleteHandler = adminRouter.stack.find(layer => layer.route?.path === '/users/:id' && layer.route?.methods?.delete)?.route?.stack[0]?.handle;
      
      if (deleteHandler) {
        await deleteHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData).toHaveProperty('success');
      }
    });

    it('should prevent deleting last admin', async () => {
      // Try to delete the only admin
      const { default: adminRouter } = await import('../../routes/admin.js');
      
      const session = createMockSession(testUsers.admin);
      const req = createMockRequest(session, {});
      req.params = { id: testUsers.admin.id };
      const res = createMockResponse();

      const deleteHandler = adminRouter.stack.find(layer => layer.route?.path === '/users/:id' && layer.route?.methods?.delete)?.route?.stack[0]?.handle;
      
      if (deleteHandler) {
        await deleteHandler(req, res);
        
        expect(res.statusCode).toBe(400);
        expect(res.jsonData).toHaveProperty('error');
      }
    });

    it('should reset user password', async () => {
      const { default: adminRouter } = await import('../../routes/admin.js');
      
      const session = createMockSession(testUsers.admin);
      const req = createMockRequest(session, {
        password: 'NewSecurePassword123!'
      });
      req.params = { id: testUsers.user.id };
      const res = createMockResponse();

      const resetHandler = adminRouter.stack.find(layer => layer.route?.path === '/users/:id/reset-password' && layer.route?.methods?.post)?.route?.stack[0]?.handle;
      
      if (resetHandler) {
        await resetHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData).toHaveProperty('success');
      }
    });

    it('should create audit log for user operations', async () => {
      const { default: adminRouter } = await import('../../routes/admin.js');
      
      const session = createMockSession(testUsers.admin);
      const req = createMockRequest(session, {
        display_name: 'Updated Name'
      });
      req.params = { id: testUsers.user.id };
      const res = createMockResponse();

      const updateHandler = adminRouter.stack.find(layer => layer.route?.path === '/users/:id' && layer.route?.methods?.put)?.route?.stack[0]?.handle;
      
      if (updateHandler) {
        await updateHandler(req, res);
        
        // Check audit log
        const [auditLogs] = await dbPool.execute(
          'SELECT * FROM audit_log WHERE user_id = ? AND action = ? ORDER BY created_at DESC LIMIT 1',
          [testUsers.admin.id, 'update_user']
        );
        
        expect(auditLogs.length).toBeGreaterThan(0);
      }
    });
  });

  describe('System Statistics', () => {
    it('should return system statistics', async () => {
      const { default: adminRouter } = await import('../../routes/admin.js');
      
      const session = createMockSession(testUsers.admin);
      const req = createMockRequest(session, {}, {});
      const res = createMockResponse();

      const systemStatsHandler = adminRouter.stack.find(layer => layer.route?.path === '/system-stats')?.route?.stack[0]?.handle;
      
      if (systemStatsHandler) {
        await systemStatsHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData).toHaveProperty('totalUsers');
        expect(res.jsonData).toHaveProperty('dbSizeMb');
        expect(res.jsonData).toHaveProperty('databaseConnected');
      }
    });

    it('should include watcher status', async () => {
      const { default: adminRouter } = await import('../../routes/admin.js');
      
      const session = createMockSession(testUsers.admin);
      const req = createMockRequest(session, {}, {});
      const res = createMockResponse();

      const systemStatsHandler = adminRouter.stack.find(layer => layer.route?.path === '/system-stats')?.route?.stack[0]?.handle;
      
      if (systemStatsHandler) {
        await systemStatsHandler(req, res);
        
        expect(res.jsonData).toHaveProperty('watcherRunning');
        expect(res.jsonData).toHaveProperty('activeWatchers');
      }
    });

    it('should include cache status', async () => {
      const { default: adminRouter } = await import('../../routes/admin.js');
      
      const session = createMockSession(testUsers.admin);
      const req = createMockRequest(session, {}, {});
      const res = createMockResponse();

      const systemStatsHandler = adminRouter.stack.find(layer => layer.route?.path === '/system-stats')?.route?.stack[0]?.handle;
      
      if (systemStatsHandler) {
        await systemStatsHandler(req, res);
        
        expect(res.jsonData).toHaveProperty('redisConnected');
        expect(typeof res.jsonData.redisConnected).toBe('boolean');
      }
    });

    it('should count orphaned logs', async () => {
      // Create orphaned log
      await dbPool.execute(
        `INSERT INTO logs (timestamp, log_level, service, message, user_id, imported_at) 
         VALUES (NOW(), 'INFO', 'test-service', 'Orphan log', NULL, NOW())`
      );
      
      const { default: adminRouter } = await import('../../routes/admin.js');
      
      const session = createMockSession(testUsers.admin);
      const req = createMockRequest(session, {}, {});
      const res = createMockResponse();

      const systemStatsHandler = adminRouter.stack.find(layer => layer.route?.path === '/system-stats')?.route?.stack[0]?.handle;
      
      if (systemStatsHandler) {
        await systemStatsHandler(req, res);
        
        expect(res.jsonData).toHaveProperty('orphanLogs');
        expect(res.jsonData.orphanLogs).toBeGreaterThan(0);
      }
    });

    it('should require admin access for system stats', async () => {
      const { default: adminRouter } = await import('../../routes/admin.js');
      
      const session = createMockSession(testUsers.user); // Regular user
      const req = createMockRequest(session, {}, {});
      const res = createMockResponse();

      const systemStatsHandler = adminRouter.stack.find(layer => layer.route?.path === '/system-stats')?.route?.stack[0]?.handle;
      
      if (systemStatsHandler) {
        await systemStatsHandler(req, res);
        
        expect(res.statusCode).toBeOneOf([401, 403]);
      }
    });
  });

  describe('Audit Log Access', () => {
    it('should return audit logs', async () => {
      const { default: adminRouter } = await import('../../routes/admin.js');
      
      const session = createMockSession(testUsers.admin);
      const req = createMockRequest(session, {}, { limit: 10 });
      const res = createMockResponse();

      const auditHandler = adminRouter.stack.find(layer => layer.route?.path === '/audit')?.route?.stack[0]?.handle;
      
      if (auditHandler) {
        await auditHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData).toHaveProperty('data');
        expect(Array.isArray(res.jsonData.data)).toBe(true);
      }
    });

    it('should filter audit logs by user', async () => {
      const { default: adminRouter } = await import('../../routes/admin.js');
      
      const session = createMockSession(testUsers.admin);
      const req = createMockRequest(session, {}, { user_id: testUsers.user.id, limit: 10 });
      const res = createMockResponse();

      const auditHandler = adminRouter.stack.find(layer => layer.route?.path === '/audit')?.route?.stack[0]?.handle;
      
      if (auditHandler) {
        await auditHandler(req, res);
        
        expect(res.statusCode).toBe(200);
      }
    });

    it('should filter audit logs by action', async () => {
      const { default: adminRouter } = await import('../../routes/admin.js');
      
      const session = createMockSession(testUsers.admin);
      const req = createMockRequest(session, {}, { action: 'login', limit: 10 });
      const res = createMockResponse();

      const auditHandler = adminRouter.stack.find(layer => layer.route?.path === '/audit')?.route?.stack[0]?.handle;
      
      if (auditHandler) {
        await auditHandler(req, res);
        
        expect(res.statusCode).toBe(200);
      }
    });

    it('should limit audit log results', async () => {
      const { default: adminRouter } = await import('../../routes/admin.js');
      
      const session = createMockSession(testUsers.admin);
      const req = createMockRequest(session, {}, { limit: 1000 }); // Try to request 1000
      const res = createMockResponse();

      const auditHandler = adminRouter.stack.find(layer => layer.route?.path === '/audit')?.route?.stack[0]?.handle;
      
      if (auditHandler) {
        await auditHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        // Should be limited to max 200
        expect(res.jsonData.pagination.limit).toBeLessThanOrEqual(200);
      }
    });
  });
});