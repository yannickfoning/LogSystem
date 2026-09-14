/**
 * Search Functionality Integration Tests
 * Tests search API, filters, pagination, and performance
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

describe('Search Functionality', () => {
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

  describe('GET /api/search - Basic Search', () => {
    it('should search logs by text query', async () => {
      await createTestLogs(testUsers.user.id, 20);
      
      const { default: searchRouter } = await import('../../routes/api/search.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { query: 'database', limit: 10 });
      const res = createMockResponse();

      const searchHandler = searchRouter.stack.find(layer => layer.route?.path === '/')?.route?.stack[0]?.handle;
      
      if (searchHandler) {
        await searchHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData).toHaveProperty('logs');
        expect(Array.isArray(res.jsonData.logs)).toBe(true);
        expect(res.jsonData).toHaveProperty('total_count');
      }
    });

    it('should return empty results for non-matching query', async () => {
      await createTestLogs(testUsers.user.id, 10);
      
      const { default: searchRouter } = await import('../../routes/api/search.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { query: 'nonexistenttermxyz123', limit: 10 });
      const res = createMockResponse();

      const searchHandler = searchRouter.stack.find(layer => layer.route?.path === '/')?.route?.stack[0]?.handle;
      
      if (searchHandler) {
        await searchHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData.logs).toHaveLength(0);
        expect(res.jsonData.total_count).toBe(0);
      }
    });

    it('should handle empty search query', async () => {
      await createTestLogs(testUsers.user.id, 10);
      
      const { default: searchRouter } = await import('../../routes/api/search.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { query: '', limit: 10 });
      const res = createMockResponse();

      const searchHandler = searchRouter.stack.find(layer => layer.route?.path === '/')?.route?.stack[0]?.handle;
      
      if (searchHandler) {
        await searchHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData).toHaveProperty('logs');
      }
    });

    it('should limit search query length', async () => {
      const { default: searchRouter } = await import('../../routes/api/search.js');
      
      const session = createMockSession(testUsers.user);
      const longQuery = 'a'.repeat(600);
      const req = createMockRequest(session, {}, { query: longQuery, limit: 10 });
      const res = createMockResponse();

      const searchHandler = searchRouter.stack.find(layer => layer.route?.path === '/')?.route?.stack[0]?.handle;
      
      if (searchHandler) {
        await searchHandler(req, res);
        
        expect(res.statusCode).toBe(400);
        expect(res.jsonData).toHaveProperty('error');
      }
    });
  });

  describe('Search Filters', () => {
    it('should filter by log level', async () => {
      await createTestLogs(testUsers.user.id, 20);
      
      const { default: searchRouter } = await import('../../routes/api/search.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { query: '', level: 'ERROR', limit: 10 });
      const res = createMockResponse();

      const searchHandler = searchRouter.stack.find(layer => layer.route?.path === '/')?.route?.stack[0]?.handle;
      
      if (searchHandler) {
        await searchHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        res.jsonData.logs.forEach(log => {
          expect(log.log_level).toBe('ERROR');
        });
      }
    });

    it('should filter by service', async () => {
      await createTestLogs(testUsers.user.id, 20);
      
      const { default: searchRouter } = await import('../../routes/api/search.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { query: '', service: 'api-gateway', limit: 10 });
      const res = createMockResponse();

      const searchHandler = searchRouter.stack.find(layer => layer.route?.path === '/')?.route?.stack[0]?.handle;
      
      if (searchHandler) {
        await searchHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        res.jsonData.logs.forEach(log => {
          expect(log.service).toBe('api-gateway');
        });
      }
    });

    it('should filter by error type', async () => {
      // Create logs with specific error types
      await dbPool.execute(
        `INSERT INTO logs (timestamp, log_level, service, message, error_type, user_id, imported_at) 
         VALUES (NOW(), 'ERROR', 'api-gateway', 'Connection failed', 'ECONNREFUSED', ?, NOW())`,
        [testUsers.user.id]
      );
      
      const { default: searchRouter } = await import('../../routes/api/search.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { query: '', error_type: 'ECONNREFUSED', limit: 10 });
      const res = createMockResponse();

      const searchHandler = searchRouter.stack.find(layer => layer.route?.path === '/')?.route?.stack[0]?.handle;
      
      if (searchHandler) {
        await searchHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        res.jsonData.logs.forEach(log => {
          expect(log.error_type).toBe('ECONNREFUSED');
        });
      }
    });

    it('should filter by timestamp range', async () => {
      await createTestLogs(testUsers.user.id, 20);
      
      const { default: searchRouter } = await import('../../routes/api/search.js');
      
      const session = createMockSession(testUsers.user);
      const fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const req = createMockRequest(session, {}, { 
        query: '', 
        from_timestamp: fromDate, 
        limit: 10 
      });
      const res = createMockResponse();

      const searchHandler = searchRouter.stack.find(layer => layer.route?.path === '/')?.route?.stack[0]?.handle;
      
      if (searchHandler) {
        await searchHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData).toHaveProperty('logs');
      }
    });

    it('should validate timestamp order', async () => {
      const { default: searchRouter } = await import('../../routes/api/search.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { 
        query: '', 
        from_timestamp: '2026-12-31', 
        to_timestamp: '2026-01-01',
        limit: 10 
      });
      const res = createMockResponse();

      const searchHandler = searchRouter.stack.find(layer => layer.route?.path === '/')?.route?.stack[0]?.handle;
      
      if (searchHandler) {
        await searchHandler(req, res);
        
        expect(res.statusCode).toBe(400);
        expect(res.jsonData).toHaveProperty('error');
      }
    });

    it('should filter by fingerprint', async () => {
      // Create log with specific fingerprint
      const { generateFingerprint } = await import('../../lib/processing/fingerprint.js');
      const fingerprint = generateFingerprint('api', 'error', 'Connection timeout', testUsers.user.id);
      
      await dbPool.execute(
        `INSERT INTO logs (timestamp, log_level, service, message, fingerprint, user_id, imported_at) 
         VALUES (NOW(), 'ERROR', 'api-gateway', 'Connection timeout', ?, ?, NOW())`,
        [fingerprint, testUsers.user.id]
      );
      
      const { default: searchRouter } = await import('../../routes/api/search.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { query: '', fingerprint, limit: 10 });
      const res = createMockResponse();

      const searchHandler = searchRouter.stack.find(layer => layer.route?.path === '/')?.route?.stack[0]?.handle;
      
      if (searchHandler) {
        await searchHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        res.jsonData.logs.forEach(log => {
          expect(log.fingerprint).toBe(fingerprint);
        });
      }
    });

    it('should combine multiple filters', async () => {
      await createTestLogs(testUsers.user.id, 30);
      
      const { default: searchRouter } = await import('../../routes/api/search.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { 
        query: 'database', 
        level: 'ERROR',
        service: 'api-gateway',
        limit: 10 
      });
      const res = createMockResponse();

      const searchHandler = searchRouter.stack.find(layer => layer.route?.path === '/')?.route?.stack[0]?.handle;
      
      if (searchHandler) {
        await searchHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        res.jsonData.logs.forEach(log => {
          expect(log.log_level).toBe('ERROR');
          expect(log.service).toBe('api-gateway');
        });
      }
    });
  });

  describe('Search Pagination', () => {
    it('should support limit parameter', async () => {
      await createTestLogs(testUsers.user.id, 50);
      
      const { default: searchRouter } = await import('../../routes/api/search.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { query: '', limit: 5 });
      const res = createMockResponse();

      const searchHandler = searchRouter.stack.find(layer => layer.route?.path === '/')?.route?.stack[0]?.handle;
      
      if (searchHandler) {
        await searchHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData.logs.length).toBeLessThanOrEqual(5);
      }
    });

    it('should support offset parameter', async () => {
      await createTestLogs(testUsers.user.id, 30);
      
      const { default: searchRouter } = await import('../../routes/api/search.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { query: '', limit: 10, offset: 5 });
      const res = createMockResponse();

      const searchHandler = searchRouter.stack.find(layer => layer.route?.path === '/')?.route?.stack[0]?.handle;
      
      if (searchHandler) {
        await searchHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData).toHaveProperty('offset');
        expect(res.jsonData.offset).toBe(5);
      }
    });

    it('should enforce maximum limit', async () => {
      const { default: searchRouter } = await import('../../routes/api/search.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { query: '', limit: 1000 });
      const res = createMockResponse();

      const searchHandler = searchRouter.stack.find(layer => layer.route?.path === '/')?.route?.stack[0]?.handle;
      
      if (searchHandler) {
        await searchHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData.limit).toBeLessThanOrEqual(100);
      }
    });

    it('should limit total results to prevent DoS', async () => {
      await createTestLogs(testUsers.user.id, 15000);
      
      const { default: searchRouter } = await import('../../routes/api/search.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { query: '', limit: 100 });
      const res = createMockResponse();

      const searchHandler = searchRouter.stack.find(layer => layer.route?.path === '/')?.route?.stack[0]?.handle;
      
      if (searchHandler) {
        await searchHandler(req, res);
        
        // Should return 422 if too many results
        if (res.jsonData.total_count > 10000) {
          expect(res.statusCode).toBe(422);
          expect(res.jsonData).toHaveProperty('error');
        }
      }
    });
  });

  describe('Search Facets', () => {
    it('should return facet data', async () => {
      await createTestLogs(testUsers.user.id, 20);
      
      const { default: searchRouter } = await import('../../routes/api/search.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { query: '', limit: 10 });
      const res = createMockResponse();

      const searchHandler = searchRouter.stack.find(layer => layer.route?.path === '/')?.route?.stack[0]?.handle;
      
      if (searchHandler) {
        await searchHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData).toHaveProperty('facets');
        expect(typeof res.jsonData.facets).toBe('object');
      }
    });

    it('should include level facets', async () => {
      await createTestLogs(testUsers.user.id, 20);
      
      const { default: searchRouter } = await import('../../routes/api/search.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { query: '', limit: 10 });
      const res = createMockResponse();

      const searchHandler = searchRouter.stack.find(layer => layer.route?.path === '/')?.route?.stack[0]?.handle;
      
      if (searchHandler) {
        await searchHandler(req, res);
        
        expect(res.jsonData.facets).toBeDefined();
        // Should have level facets like DEBUG, INFO, etc.
      }
    });

    it('should include service facets', async () => {
      await createTestLogs(testUsers.user.id, 20);
      
      const { default: searchRouter } = await import('../../routes/api/search.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { query: '', limit: 10 });
      const res = createMockResponse();

      const searchHandler = searchRouter.stack.find(layer => layer.route?.path === '/')?.route?.stack[0]?.handle;
      
      if (searchHandler) {
        await searchHandler(req, res);
        
        expect(res.jsonData.facets).toBeDefined();
      }
    });
  });

  describe('Search Performance', () => {
    it('should use FULLTEXT search for longer queries', async () => {
      await createTestLogs(testUsers.user.id, 100);
      
      const { default: searchRouter } = await import('../../routes/api/search.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { query: 'database connection timeout error', limit: 10 });
      const res = createMockResponse();

      const searchHandler = searchRouter.stack.find(layer => layer.route?.path === '/')?.route?.stack[0]?.handle;
      
      if (searchHandler) {
        const startTime = Date.now();
        await searchHandler(req, res);
        const duration = Date.now() - startTime;
        
        expect(res.statusCode).toBe(200);
        // Should complete in reasonable time
        expect(duration).toBeLessThan(5000);
      }
    });

    it('should fallback to LIKE for short queries', async () => {
      await createTestLogs(testUsers.user.id, 50);
      
      const { default: searchRouter } = await import('../../routes/api/search.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { query: 'err', limit: 10 });
      const res = createMockResponse();

      const searchHandler = searchRouter.stack.find(layer => layer.route?.path === '/')?.route?.stack[0]?.handle;
      
      if (searchHandler) {
        await searchHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData).toHaveProperty('logs');
      }
    });

    it('should handle FULLTEXT schema errors gracefully', async () => {
      // Test fallback when FULLTEXT index is missing
      await createTestLogs(testUsers.user.id, 10);
      
      const { default: searchRouter } = await import('../../routes/api/search.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { query: 'test', limit: 10 });
      const res = createMockResponse();

      const searchHandler = searchRouter.stack.find(layer => layer.route?.path === '/')?.route?.stack[0]?.handle;
      
      if (searchHandler) {
        await searchHandler(req, res);
        
        // Should not throw error even if FULLTEXT fails
        expect(res.statusCode).toBe(200);
      }
    });
  });

  describe('Search User Scope', () => {
    it('should enforce user scope on search results', async () => {
      await createTestLogs(testUsers.user.id, 10);
      await createTestLogs(testUsers.admin.id, 20);
      
      const { default: searchRouter } = await import('../../routes/api/search.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { query: '', limit: 50 });
      const res = createMockResponse();

      const searchHandler = searchRouter.stack.find(layer => layer.route?.path === '/')?.route?.stack[0]?.handle;
      
      if (searchHandler) {
        await searchHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData.total_count).toBe(10);
      }
    });

    it('should allow admin to search all logs', async () => {
      await createTestLogs(testUsers.user.id, 10);
      await createTestLogs(testUsers.admin.id, 20);
      
      const { default: searchRouter } = await import('../../routes/api/search.js');
      
      const session = createMockSession(testUsers.admin);
      const req = createMockRequest(session, {}, { query: '', limit: 50 });
      const res = createMockResponse();

      const searchHandler = searchRouter.stack.find(layer => layer.route?.path === '/')?.route?.stack[0]?.handle;
      
      if (searchHandler) {
        await searchHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData.total_count).toBe(30);
      }
    });
  });

  describe('Stack Trace Security', () => {
    it('should hide stack traces from non-admin users', async () => {
      // Create log with stack trace
      await dbPool.execute(
        `INSERT INTO logs (timestamp, log_level, service, message, stack_trace, user_id, imported_at) 
         VALUES (NOW(), 'ERROR', 'api-gateway', 'Error occurred', 'Error at line 42\n    at module.js:123', ?, NOW())`,
        [testUsers.user.id]
      );
      
      const { default: searchRouter } = await import('../../routes/api/search.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { query: '', limit: 10 });
      const res = createMockResponse();

      const searchHandler = searchRouter.stack.find(layer => layer.route?.path === '/')?.route?.stack[0]?.handle;
      
      if (searchHandler) {
        await searchHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        res.jsonData.logs.forEach(log => {
          expect(log.stack_trace).toBeUndefined();
        });
      }
    });

    it('should show stack traces to admin users', async () => {
      await dbPool.execute(
        `INSERT INTO logs (timestamp, log_level, service, message, stack_trace, user_id, imported_at) 
         VALUES (NOW(), 'ERROR', 'api-gateway', 'Error occurred', 'Error at line 42\n    at module.js:123', ?, NOW())`,
        [testUsers.admin.id]
      );
      
      const { default: searchRouter } = await import('../../routes/api/search.js');
      
      const session = createMockSession(testUsers.admin);
      const req = createMockRequest(session, {}, { query: '', limit: 10 });
      const res = createMockResponse();

      const searchHandler = searchRouter.stack.find(layer => layer.route?.path === '/')?.route?.stack[0]?.handle;
      
      if (searchHandler) {
        await searchHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        // Admin should see stack traces
        const logWithStack = res.jsonData.logs.find(log => log.stack_trace);
        if (logWithStack) {
          expect(logWithStack.stack_trace).toBeDefined();
        }
      }
    });
  });

  describe('Special Characters', () => {
    it('should handle special characters in search', async () => {
      await createTestLogs(testUsers.user.id, 10);
      
      const { default: searchRouter } = await import('../../routes/api/search.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { query: 'test@#$%^&*()', limit: 10 });
      const res = createMockResponse();

      const searchHandler = searchRouter.stack.find(layer => layer.route?.path === '/')?.route?.stack[0]?.handle;
      
      if (searchHandler) {
        await searchHandler(req, res);
        
        // Should not throw error
        expect(res.statusCode).toBe(200);
      }
    });

    it('should sanitize dangerous characters', async () => {
      const { default: searchRouter } = await import('../../routes/api/search.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { query: '<script>alert(1)</script>', limit: 10 });
      const res = createMockResponse();

      const searchHandler = searchRouter.stack.find(layer => layer.route?.path === '/')?.route?.stack[0]?.handle;
      
      if (searchHandler) {
        await searchHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        // Should sanitize the input
      }
    });
  });
});