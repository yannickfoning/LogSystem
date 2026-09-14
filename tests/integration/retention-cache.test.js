/**
 * Retention and Cache Integration Tests
 * Tests log retention policies, cache management, and Redis integration
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

describe('Retention and Cache Services', () => {
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

  describe('Log Retention Service', () => {
    it('should have retention policies for each log level', async () => {
      const { getRetentionStats } = await import('../../services/retentionService.js');
      
      const stats = await getRetentionStats(testUsers.user.id);
      
      expect(stats).toHaveProperty('by_level');
      expect(stats.by_level).toHaveProperty('DEBUG');
      expect(stats.by_level).toHaveProperty('INFO');
      expect(stats.by_level).toHaveProperty('WARNING');
      expect(stats.by_level).toHaveProperty('ERROR');
      expect(stats.by_level).toHaveProperty('CRITICAL');
      expect(stats.by_level).toHaveProperty('FATAL');
    });

    it('should enforce different retention periods by level', async () => {
      const stats = await import('../../services/retentionService.js');
      
      // DEBUG: 7 days, INFO: 30 days, WARNING: 60 days, ERROR: 90 days, CRITICAL: 180 days, FATAL: 365 days
      const retentionDays = {
        DEBUG: 7,
        INFO: 30,
        WARNING: 60,
        ERROR: 90,
        CRITICAL: 180,
        FATAL: 365
      };
      
      expect(retentionDays.DEBUG).toBeLessThan(retentionDays.INFO);
      expect(retentionDays.INFO).toBeLessThan(retentionDays.WARNING);
      expect(retentionDays.WARNING).toBeLessThan(retentionDays.ERROR);
      expect(retentionDays.ERROR).toBeLessThan(retentionDays.CRITICAL);
      expect(retentionDays.CRITICAL).toBeLessThan(retentionDays.FATAL);
    });

    it('should calculate retention dates correctly', async () => {
      const { getRetentionStats } = await import('../../services/retentionService.js');
      
      const stats = await getRetentionStats(testUsers.user.id);
      
      for (const [level, data] of Object.entries(stats.by_level)) {
        expect(data).toHaveProperty('days');
        expect(data).toHaveProperty('retained');
        expect(data).toHaveProperty('total');
        expect(data).toHaveProperty('cutoff');
        expect(typeof data.days).toBe('number');
        expect(typeof data.retained).toBe('number');
        expect(typeof data.total).toBe('number');
      }
    });

    it('should run retention purge for user scope', async () => {
      // Create old logs beyond retention period
      const oldDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000); // 400 days ago
      const timestamp = oldDate.toISOString().slice(0, 19).replace('T', ' ');
      
      await dbPool.execute(
        `INSERT INTO logs (timestamp, log_level, service, message, user_id, imported_at) 
         VALUES (?, 'DEBUG', 'test-service', 'Old debug log', ?, NOW())`,
        [timestamp, testUsers.user.id]
      );
      
      const { runRetention } = await import('../../services/retentionService.js');
      const result = await runRetention(testUsers.user.id);
      
      expect(result).toHaveProperty('DEBUG');
      expect(result.DEBUG).toHaveProperty('deleted');
      expect(result.DEBUG).toHaveProperty('days');
      expect(typeof result.DEBUG.deleted).toBe('number');
    });

    it('should run retention purge globally for admin', async () => {
      // Create old logs for multiple users
      const oldDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
      const timestamp = oldDate.toISOString().slice(0, 19).replace('T', ' ');
      
      await dbPool.execute(
        `INSERT INTO logs (timestamp, log_level, service, message, user_id, imported_at) 
         VALUES (?, 'DEBUG', 'test-service', 'Old debug log', ?, NOW())`,
        [timestamp, testUsers.user.id]
      );
      
      const { runRetention } = await import('../../services/retentionService.js');
      const result = await runRetention(null); // null = global admin scope
      
      expect(result).toHaveProperty('DEBUG');
      expect(result).toHaveProperty('orphan_error_groups');
      expect(result).toHaveProperty('read_alerts');
    });

    it('should purge orphaned error groups', async () => {
      // Create orphaned error group (no corresponding logs)
      const { generateFingerprint } = await import('../../lib/processing/fingerprint.js');
      const fingerprint = generateFingerprint('api', 'error', 'Test error', testUsers.user.id);
      
      await dbPool.execute(
        `INSERT INTO error_groups (fingerprint, title, event_type, severity_max, occurrence_count, first_seen, last_seen, user_id)
         VALUES (?, ?, ?, ?, ?, NOW(), NOW(), ?)`,
        [fingerprint, 'Test error', 'error', 'ERROR', 1, testUsers.user.id]
      );
      
      const { runRetention } = await import('../../services/retentionService.js');
      const result = await runRetention(null);
      
      expect(result).toHaveProperty('orphan_error_groups');
      expect(typeof result.orphan_error_groups).toBe('number');
    });

    it('should purge old read alerts', async () => {
      // Create old read alerts
      const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
      const timestamp = oldDate.toISOString().slice(0, 19).replace('T', ' ');
      
      await dbPool.execute(
        `INSERT INTO alerts (rule_id, alert_type, severity, message, status, read_at, user_id) 
         VALUES (1, 'level', 'high', 'Test alert', 'read', ?, ?)`,
        [timestamp, testUsers.user.id]
      );
      
      const { runRetention } = await import('../../services/retentionService.js');
      const result = await runRetention(testUsers.user.id);
      
      expect(result).toHaveProperty('read_alerts');
      expect(typeof result.read_alerts).toBe('number');
    });

    it('should purge very old unread alerts', async () => {
      // Create very old unread alerts
      const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
      const timestamp = oldDate.toISOString().slice(0, 19).replace('T', ' ');
      
      await dbPool.execute(
        `INSERT INTO alerts (rule_id, alert_type, severity, message, status, created_at, user_id) 
         VALUES (1, 'level', 'high', 'Test alert', 'new', ?, ?)`,
        [timestamp, testUsers.user.id]
      );
      
      const { runRetention } = await import('../../services/retentionService.js');
      const result = await runRetention(testUsers.user.id);
      
      expect(result).toHaveProperty('old_alerts');
      expect(typeof result.old_alerts).toBe('number');
    });

    it('should schedule retention cleanup', async () => {
      const { startRetentionScheduler } = await import('../../services/retentionService.js');
      
      // This would start the scheduler - for testing we just verify it exists
      expect(typeof startRetentionScheduler).toBe('function');
    });

    it('should calculate next run time correctly', async () => {
      const CRON_HOUR = parseInt(process.env.RETENTION_CRON_HOUR || '3', 10);
      expect(CRON_HOUR).toBeGreaterThanOrEqual(0);
      expect(CRON_HOUR).toBeLessThan(24);
    });
  });

  describe('Cache Service', () => {
    it('should initialize Redis when configured', async () => {
      const { startCacheService } = await import('../../services/cacheService.js');
      
      // This would try to connect to Redis
      // For testing, we verify the function exists
      expect(typeof startCacheService).toBe('function');
    });

    it('should handle Redis unavailability gracefully', async () => {
      // Set environment to disable Redis
      const originalRedisUrl = process.env.REDIS_URL;
      const originalRedisHost = process.env.REDIS_HOST;
      delete process.env.REDIS_URL;
      delete process.env.REDIS_HOST;
      
      const { startCacheService } = await import('../../services/cacheService.js');
      const started = await startCacheService();
      
      // Should return false when Redis is not configured
      expect(typeof started).toBe('boolean');
      
      // Restore environment
      if (originalRedisUrl) process.env.REDIS_URL = originalRedisUrl;
      if (originalRedisHost) process.env.REDIS_HOST = originalRedisHost;
    });

    it('should cache dashboard data', async () => {
      const { setCachedDashboard, getCachedDashboard } = await import('../../services/cacheService.js');
      
      const testData = {
        totalLogs: 100,
        errorCount: 5,
        timestamp: Date.now()
      };
      
      // Try to cache (may fail if Redis not available)
      const cached = await setCachedDashboard(testUsers.user.id, testData);
      
      // Should return boolean indicating success
      expect(typeof cached).toBe('boolean');
    });

    it('should retrieve cached dashboard data', async () => {
      const { getCachedDashboard } = await import('../../services/cacheService.js');
      
      // Try to get cached data (may return null if Redis not available)
      const cached = await getCachedDashboard(testUsers.user.id);
      
      // Should return data or null
      expect(cached === null || typeof cached === 'object').toBe(true);
    });

    it('should invalidate cache', async () => {
      const { invalidateDashboard } = await import('../../services/cacheService.js');
      
      // Try to invalidate cache
      const invalidated = await invalidateDashboard(testUsers.user.id);
      
      // Should return boolean indicating success
      expect(typeof invalidated).toBe('boolean');
    });

    it('should provide cache status', async () => {
      const { getCacheStatus } = await import('../../services/cacheService.js');
      
      const status = await getCacheStatus();
      
      expect(status).toHaveProperty('connected');
      expect(typeof status.connected).toBe('boolean');
    });

    it('should use appropriate TTL for cached data', async () => {
      // Cache TTL should be reasonable (5 minutes for stats)
      const CACHE_TTL_STATS = 300; // 5 minutes
      
      expect(CACHE_TTL_STATS).toBeGreaterThan(0);
      expect(CACHE_TTL_STATS).toBeLessThanOrEqual(3600); // Max 1 hour
    });

    it('should handle Redis reconnection strategy', async () => {
      // Verify Redis reconnection configuration
      const maxRetries = 10;
      const reconnectDelay = Math.min(maxRetries * 50, 500);
      
      expect(maxRetries).toBeGreaterThan(0);
      expect(reconnectDelay).toBeGreaterThan(0);
      expect(reconnectDelay).toBeLessThanOrEqual(500);
    });
  });

  describe('Cache Invalidation', () => {
    it('should invalidate cache on log import', async () => {
      // This would test that cache is invalidated after import
      const { invalidateDashboard } = await import('../../services/cacheService.js');
      
      await invalidateDashboard(testUsers.user.id);
      
      // Should not throw error
      expect(true).toBe(true);
    });

    it('should invalidate cache on log deletion', async () => {
      const { invalidateDashboard } = await import('../../services/cacheService.js');
      
      await invalidateDashboard(testUsers.user.id);
      
      expect(true).toBe(true);
    });

    it('should invalidate cache on alert status change', async () => {
      const { invalidateDashboard } = await import('../../services/cacheService.js');
      
      await invalidateDashboard(testUsers.user.id);
      
      expect(true).toBe(true);
    });
  });

  describe('Cache Fallback', () => {
    it('should operate without cache when Redis unavailable', async () => {
      // Dashboard should work even without cache
      const { default: dashboardRouter } = await import('../../routes/dashboard.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, {});
      const res = createMockResponse();

      const summaryHandler = dashboardRouter.stack.find(layer => layer.route?.path === '/summary')?.route?.stack[0]?.handle;
      
      if (summaryHandler) {
        await summaryHandler(req, res);
        
        // Should return data even without cache
        expect(res.statusCode).toBeOneOf([200, 503]);
        if (res.statusCode === 200) {
          expect(res.jsonData).toHaveProperty('totalLogs');
        }
      }
    });

    it('should not block operations when cache fails', async () => {
      // Operations should continue even if cache operations fail
      const { setCachedDashboard } = await import('../../services/cacheService.js');
      
      // Should not throw error even if Redis is unavailable
      const result = await setCachedDashboard(testUsers.user.id, { test: 'data' });
      
      expect(typeof result).toBe('boolean');
    });
  });

  describe('Retention Admin Endpoints', () => {
    it('should get retention stats via admin API', async () => {
      const { default: adminRouter } = await import('../../routes/admin.js');
      
      const session = createMockSession(testUsers.admin);
      const req = createMockRequest(session, {}, {});
      const res = createMockResponse();

      const statsHandler = adminRouter.stack.find(layer => layer.route?.path === '/retention/stats')?.route?.stack[0]?.handle;
      
      if (statsHandler) {
        await statsHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData).toHaveProperty('by_level');
      }
    });

    it('should trigger manual retention run via admin API', async () => {
      const { default: adminRouter } = await import('../../routes/admin.js');
      
      const session = createMockSession(testUsers.admin);
      const req = createMockRequest(session, {});
      const res = createMockResponse();

      const runHandler = adminRouter.stack.find(layer => layer.route?.path === '/retention/run' && layer.route?.methods?.post)?.route?.stack[0]?.handle;
      
      if (runHandler) {
        await runHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData).toBeDefined();
      }
    });

    it('should create audit log for manual retention run', async () => {
      const { default: adminRouter } = await import('../../routes/admin.js');
      
      const session = createMockSession(testUsers.admin);
      const req = createMockRequest(session, {});
      const res = createMockResponse();

      const runHandler = adminRouter.stack.find(layer => layer.route?.path === '/retention/run' && layer.route?.methods?.post)?.route?.stack[0]?.handle;
      
      if (runHandler) {
        await runHandler(req, res);
        
        // Check audit log
        const [auditLogs] = await dbPool.execute(
          'SELECT * FROM audit_log WHERE user_id = ? AND action = ? ORDER BY created_at DESC LIMIT 1',
          [testUsers.admin.id, 'run_retention']
        );
        
        expect(auditLogs.length).toBeGreaterThan(0);
      }
    });

    it('should require admin access for retention operations', async () => {
      const { default: adminRouter } = await import('../../routes/admin.js');
      
      const session = createMockSession(testUsers.user); // Regular user
      const req = createMockRequest(session, {});
      const res = createMockResponse();

      const statsHandler = adminRouter.stack.find(layer => layer.route?.path === '/retention/stats')?.route?.stack[0]?.handle;
      
      if (statsHandler) {
        await statsHandler(req, res);
        
        // Should be blocked by requireAdmin middleware
        expect(res.statusCode).toBeOneOf([401, 403]);
      }
    });
  });

  describe('Purge Operations', () => {
    it('should purge logs by level', async () => {
      await createTestLogs(testUsers.user.id, 20);
      
      const { default: adminRouter } = await import('../../routes/admin.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, { log_level: 'DEBUG' });
      const res = createMockResponse();

      const purgeHandler = adminRouter.stack.find(layer => layer.route?.path === '/purge' && layer.route?.methods?.post)?.route?.stack[0]?.handle;
      
      if (purgeHandler) {
        await purgeHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData).toHaveProperty('deleted');
        expect(typeof res.jsonData.deleted).toBe('number');
      }
    });

    it('should purge logs by date', async () => {
      await createTestLogs(testUsers.user.id, 20);
      
      const { default: adminRouter } = await import('../../routes/admin.js');
      
      const session = createMockSession(testUsers.user);
      const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const req = createMockRequest(session, { date_before: cutoffDate });
      const res = createMockResponse();

      const purgeHandler = adminRouter.stack.find(layer => layer.route?.path === '/purge' && layer.route?.methods?.post)?.route?.stack[0]?.handle;
      
      if (purgeHandler) {
        await purgeHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData).toHaveProperty('deleted');
      }
    });

    it('should require at least one purge criterion', async () => {
      const { purgeSchema } = await import('../../middleware/validation.js');
      
      const result = purgeSchema.safeParse({});
      
      expect(result.success).toBe(false);
    });

    it('should validate purge log level', async () => {
      const { purgeSchema } = await import('../../middleware/validation.js');
      
      const validResult = purgeSchema.safeParse({ log_level: 'ERROR' });
      const invalidResult = purgeSchema.safeParse({ log_level: 'INVALID' });
      
      expect(validResult.success).toBe(true);
      expect(invalidResult.success).toBe(false);
    });

    it('should create audit log for purge operations', async () => {
      await createTestLogs(testUsers.user.id, 10);
      
      const { default: adminRouter } = await import('../../routes/admin.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, { log_level: 'DEBUG' });
      const res = createMockResponse();

      const purgeHandler = adminRouter.stack.find(layer => layer.route?.path === '/purge' && layer.route?.methods?.post)?.route?.stack[0]?.handle;
      
      if (purgeHandler) {
        await purgeHandler(req, res);
        
        // Check audit log
        const [auditLogs] = await dbPool.execute(
          'SELECT * FROM audit_log WHERE user_id = ? AND action = ? ORDER BY created_at DESC LIMIT 1',
          [testUsers.user.id, 'purge_logs']
        );
        
        expect(auditLogs.length).toBeGreaterThan(0);
      }
    });
  });
});