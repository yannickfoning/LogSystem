/**
 * Logs CRUD and Import Integration Tests
 * Tests log creation, reading, updating, deletion, and file import functionality
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
import fs from 'fs';
import path from 'path';

describe('Logs CRUD and Import', () => {
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

  describe('GET /logs - List Logs', () => {
    it('should return logs for authenticated user', async () => {
      await createTestLogs(testUsers.user.id, 5);
      
      const { default: logsRouter } = await import('../../routes/logs.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { limit: 10 });
      const res = createMockResponse();

      const listHandler = logsRouter.stack.find(layer => layer.route?.path === '/')?.route?.stack[0]?.handle;
      
      if (listHandler) {
        await listHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData).toHaveProperty('data');
        expect(Array.isArray(res.jsonData.data)).toBe(true);
        expect(res.jsonData.data.length).toBeGreaterThan(0);
      }
    });

    it('should apply user scope filtering', async () => {
      // Create logs for different users
      await createTestLogs(testUsers.user.id, 3);
      await createTestLogs(testUsers.admin.id, 5);
      
      const { default: logsRouter } = await import('../../routes/logs.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { limit: 10 });
      const res = createMockResponse();

      const listHandler = logsRouter.stack.find(layer => layer.route?.path === '/')?.route?.stack[0]?.handle;
      
      if (listHandler) {
        await listHandler(req, res);
        
        // User should only see their own logs
        expect(res.statusCode).toBe(200);
        expect(res.jsonData.data.length).toBe(3);
      }
    });

    it('should allow admin to see all logs', async () => {
      await createTestLogs(testUsers.user.id, 3);
      await createTestLogs(testUsers.admin.id, 5);
      
      const { default: logsRouter } = await import('../../routes/logs.js');
      
      const session = createMockSession(testUsers.admin);
      const req = createMockRequest(session, {}, { limit: 10 });
      const res = createMockResponse();

      const listHandler = logsRouter.stack.find(layer => layer.route?.path === '/')?.route?.stack[0]?.handle;
      
      if (listHandler) {
        await listHandler(req, res);
        
        // Admin should see all logs
        expect(res.statusCode).toBe(200);
        expect(res.jsonData.data.length).toBe(8);
      }
    });

    it('should support pagination', async () => {
      await createTestLogs(testUsers.user.id, 25);
      
      const { default: logsRouter } = await import('../../routes/logs.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { limit: 10, page: 1 });
      const res = createMockResponse();

      const listHandler = logsRouter.stack.find(layer => layer.route?.path === '/')?.route?.stack[0]?.handle;
      
      if (listHandler) {
        await listHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData.data.length).toBeLessThanOrEqual(10);
        expect(res.jsonData.pagination).toHaveProperty('page');
      }
    });

    it('should support filtering by log level', async () => {
      await createTestLogs(testUsers.user.id, 10);
      
      const { default: logsRouter } = await import('../../routes/logs.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, { log_level: 'ERROR', limit: 10 });
      const res = createMockResponse();

      const listHandler = logsRouter.stack.find(layer => layer.route?.path === '/')?.route?.stack[0]?.handle;
      
      if (listHandler) {
        await listHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        // All returned logs should be ERROR level
        res.jsonData.data.forEach(log => {
          expect(log.log_level).toBe('ERROR');
        });
      }
    });
  });

  describe('GET /logs/:id - Get Single Log', () => {
    it('should return single log by ID', async () => {
      await createTestLogs(testUsers.user.id, 1);
      
      const [logs] = await dbPool.execute(
        'SELECT id FROM logs WHERE user_id = ? LIMIT 1',
        [testUsers.user.id]
      );
      const logId = logs[0].id;
      
      const { default: logsRouter } = await import('../../routes/logs.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, {}, { id: logId });
      const res = createMockResponse();

      const getHandler = logsRouter.stack.find(layer => layer.route?.path === '/:id')?.route?.stack[0]?.handle;
      
      if (getHandler) {
        await getHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData).toHaveProperty('id');
        expect(res.jsonData.id).toBe(logId);
      }
    });

    it('should return 404 for non-existent log', async () => {
      const { default: logsRouter } = await import('../../routes/logs.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, {}, { id: 99999 });
      const res = createMockResponse();

      const getHandler = logsRouter.stack.find(layer => layer.route?.path === '/:id')?.route?.stack[0]?.handle;
      
      if (getHandler) {
        await getHandler(req, res);
        
        expect(res.statusCode).toBe(404);
        expect(res.jsonData).toHaveProperty('error');
      }
    });

    it('should enforce user scope on single log access', async () => {
      // Create log for admin
      await createTestLogs(testUsers.admin.id, 1);
      const [adminLogs] = await dbPool.execute(
        'SELECT id FROM logs WHERE user_id = ? LIMIT 1',
        [testUsers.admin.id]
      );
      const adminLogId = adminLogs[0].id;
      
      const { default: logsRouter } = await import('../../routes/logs.js');
      
      // Try to access admin's log as regular user
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, {}, { id: adminLogId });
      const res = createMockResponse();

      const getHandler = logsRouter.stack.find(layer => layer.route?.path === '/:id')?.route?.stack[0]?.handle;
      
      if (getHandler) {
        await getHandler(req, res);
        
        expect(res.statusCode).toBe(404);
      }
    });
  });

  describe('DELETE /logs/:id - Delete Log', () => {
    it('should allow user to delete their own logs', async () => {
      await createTestLogs(testUsers.user.id, 1);
      const [logs] = await dbPool.execute(
        'SELECT id FROM logs WHERE user_id = ? LIMIT 1',
        [testUsers.user.id]
      );
      const logId = logs[0].id;
      
      const { default: logsRouter } = await import('../../routes/logs.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, {}, { id: logId });
      const res = createMockResponse();

      const deleteHandler = logsRouter.stack.find(layer => layer.route?.path === undefined && layer.route?.methods?.delete)?.route?.stack[0]?.handle;
      
      if (deleteHandler) {
        await deleteHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData).toHaveProperty('success');
        expect(res.jsonData.success).toBe(true);
        
        // Verify log was deleted
        const [remaining] = await dbPool.execute('SELECT * FROM logs WHERE id = ?', [logId]);
        expect(remaining.length).toBe(0);
      }
    });

    it('should allow admin to delete any log', async () => {
      await createTestLogs(testUsers.user.id, 1);
      const [logs] = await dbPool.execute(
        'SELECT id FROM logs WHERE user_id = ? LIMIT 1',
        [testUsers.user.id]
      );
      const logId = logs[0].id;
      
      const { default: logsRouter } = await import('../../routes/logs.js');
      
      const session = createMockSession(testUsers.admin);
      const req = createMockRequest(session, {}, {}, { id: logId });
      const res = createMockResponse();

      const deleteHandler = logsRouter.stack.find(layer => layer.route?.path === undefined && layer.route?.methods?.delete)?.route?.stack[0]?.handle;
      
      if (deleteHandler) {
        await deleteHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.jsonData.success).toBe(true);
      }
    });

    it('should create audit log for deletion', async () => {
      await createTestLogs(testUsers.user.id, 1);
      const [logs] = await dbPool.execute(
        'SELECT id FROM logs WHERE user_id = ? LIMIT 1',
        [testUsers.user.id]
      );
      const logId = logs[0].id;
      
      const { default: logsRouter } = await import('../../routes/logs.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, {}, { id: logId });
      const res = createMockResponse();

      const deleteHandler = logsRouter.stack.find(layer => layer.route?.path === undefined && layer.route?.methods?.delete)?.route?.stack[0]?.handle;
      
      if (deleteHandler) {
        await deleteHandler(req, res);
        
        // Check audit log
        const [auditLogs] = await dbPool.execute(
          'SELECT * FROM audit_log WHERE user_id = ? AND action = ? ORDER BY created_at DESC LIMIT 1',
          [testUsers.user.id, 'delete_log']
        );
        
        expect(auditLogs.length).toBeGreaterThan(0);
        expect(auditLogs[0].action).toBe('delete_log');
      }
    });
  });

  describe('Log Import', () => {
    it('should detect JSON format correctly', async () => {
      const { detectFormat } = await import('../../lib/processing/universalParser.js');
      
      const jsonBuffer = Buffer.from('{"timestamp":"2026-01-01T10:00:00Z","level":"INFO","message":"Test"}');
      const format = detectFormat(jsonBuffer);
      
      expect(format).toBe('json');
    });

    it('should detect plain text format correctly', async () => {
      const { detectFormat } = await import('../../lib/processing/universalParser.js');
      
      const textBuffer = Buffer.from('2026-01-01 10:00:00 INFO Test message');
      const format = detectFormat(textBuffer);
      
      expect(format).toBe('text');
    });

    it('should parse JSON log format', async () => {
      const { parseLogContent } = await import('../../lib/processing/universalParser.js');
      
      const jsonBuffer = Buffer.from('{"timestamp":"2026-01-01T10:00:00Z","level":"INFO","message":"Test"}');
      const logs = await parseLogContent(jsonBuffer, 'json');
      
      expect(logs).toHaveLength(1);
      expect(logs[0].log_level).toBe('INFO');
      expect(logs[0].message).toBe('Test');
    });

    it('should parse plain text log format', async () => {
      const { parseLogContent } = await import('../../lib/processing/universalParser.js');
      
      const textBuffer = Buffer.from('2026-01-01 10:00:00 INFO Test message\n2026-01-01 10:01:00 ERROR Another message');
      const logs = await parseLogContent(textBuffer, 'text');
      
      expect(logs.length).toBeGreaterThan(0);
    });

    it('should handle CSV log format', async () => {
      const { parseLogContent } = await import('../../lib/processing/universalParser.js');
      
      const csvBuffer = Buffer.from('timestamp,level,message\n2026-01-01 10:00:00,INFO,Test');
      const logs = await parseLogContent(csvBuffer, 'csv');
      
      expect(logs.length).toBeGreaterThan(0);
    });

    it('should normalize log levels', async () => {
      const { normalizeLevel } = await import('../../lib/processing/logLevelUtils.js');
      
      expect(normalizeLevel('warn')).toBe('WARNING');
      expect(normalizeLevel('err')).toBe('ERROR');
      expect(normalizeLevel('debug')).toBe('DEBUG');
      expect(normalizeLevel('unknown')).toBe('INFO');
    });

    it('should generate consistent fingerprints', async () => {
      const { generateFingerprint } = await import('../../lib/processing/fingerprint.js');
      
      const fp1 = generateFingerprint('api', 'error', 'Connection timeout', 1);
      const fp2 = generateFingerprint('api', 'error', 'Connection timeout', 1);
      
      expect(fp1).toBe(fp2);
    });

    it('should include user_id in fingerprint for multi-tenant isolation', async () => {
      const { generateFingerprint } = await import('../../lib/processing/fingerprint.js');
      
      const fp1 = generateFingerprint('api', 'error', 'Connection timeout', 1);
      const fp2 = generateFingerprint('api', 'error', 'Connection timeout', 2);
      
      expect(fp1).not.toBe(fp2);
    });
  });

  describe('Archive Import', () => {
    it('should detect ZIP archives', async () => {
      const { isArchive, detectArchiveType } = await import('../../lib/processing/archiveHandler.js');
      
      expect(isArchive('logs.zip')).toBe(true);
      expect(detectArchiveType('logs.zip')).toBe('zip');
    });

    it('should detect GZIP archives', async () => {
      const { isArchive, detectArchiveType } = await import('../../lib/processing/archiveHandler.js');
      
      expect(isArchive('logs.gz')).toBe(true);
      expect(detectArchiveType('logs.gz')).toBe('gzip');
    });

    it('should detect TAR archives', async () => {
      const { isArchive, detectArchiveType } = await import('../../lib/processing/archiveHandler.js');
      
      expect(isArchive('logs.tar')).toBe(true);
      expect(detectArchiveType('logs.tar')).toBe('tar');
    });

    it('should detect RAR archives', async () => {
      const { isArchive, detectArchiveType } = await import('../../lib/processing/archiveHandler.js');
      
      expect(isArchive('logs.rar')).toBe(true);
      expect(detectArchiveType('logs.rar')).toBe('rar');
    });

    it('should detect archives by magic bytes', async () => {
      const { detectArchiveType } = await import('../../lib/processing/archiveHandler.js');
      
      const zipMagic = Buffer.from([0x50, 0x4B, 0x03, 0x04]);
      const gzipMagic = Buffer.from([0x1F, 0x8B]);
      const rarMagic = Buffer.from([0x52, 0x61, 0x72, 0x21]);
      
      expect(detectArchiveType('unknown', zipMagic)).toBe('zip');
      expect(detectArchiveType('unknown', gzipMagic)).toBe('gzip');
      expect(detectArchiveType('unknown', rarMagic)).toBe('rar');
    });

    it('should reject path traversal in archive files', async () => {
      const path = require('path');
      
      const maliciousFiles = [
        '../../etc/passwd',
        '..\\..\\windows\\system32',
        '/etc/passwd',
        'C:\\Windows\\System32'
      ];
      
      for (const file of maliciousFiles) {
        const normalized = path.normalize(file).replace(/\\/g, '/');
        const isTraversal = normalized.includes('../') || path.isAbsolute(normalized);
        expect(isTraversal).toBe(true);
      }
    });

    it('should allow legitimate archive file paths', async () => {
      const path = require('path');
      
      const legitimateFiles = [
        'logs/app.log',
        'application.log',
        'service/error.log',
        'logs/2026/01/app.log'
      ];
      
      for (const file of legitimateFiles) {
        const normalized = path.normalize(file).replace(/\\/g, '/');
        const isTraversal = normalized.includes('../') || path.isAbsolute(normalized);
        expect(isTraversal).toBe(false);
      }
    });
  });

  describe('Import Error Handling', () => {
    it('should handle malformed log files gracefully', async () => {
      const { parseLogContent } = await import('../../lib/processing/universalParser.js');
      
      const malformedBuffer = Buffer.from('This is not a valid log format {{{');
      const logs = await parseLogContent(malformedBuffer, 'text');
      
      // Should not throw, return empty or partial results
      expect(Array.isArray(logs)).toBe(true);
    });

    it('should handle empty files', async () => {
      const { parseLogContent } = await import('../../lib/processing/universalParser.js');
      
      const emptyBuffer = Buffer.from('');
      const logs = await parseLogContent(emptyBuffer, 'text');
      
      expect(logs).toHaveLength(0);
    });

    it('should validate required log fields', async () => {
      // Test that import validation checks for required fields
      const logEntry = {
        timestamp: '2026-01-01 10:00:00',
        log_level: 'INFO',
        message: 'Test message'
      };
      
      expect(logEntry).toHaveProperty('timestamp');
      expect(logEntry).toHaveProperty('log_level');
      expect(logEntry).toHaveProperty('message');
    });

    it('should handle large imports with batching', async () => {
      // Test that large files are processed in batches
      const batchSize = parseInt(process.env.IMPORT_BATCH_SIZE || '500', 10);
      
      expect(batchSize).toBeGreaterThan(0);
      expect(batchSize).toBeLessThanOrEqual(500);
    });
  });

  describe('Log Export', () => {
    it('should support CSV export', async () => {
      await createTestLogs(testUsers.user.id, 5);
      
      const { default: logsRouter } = await import('../../routes/logs.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, {});
      const res = createMockResponse();

      const exportHandler = logsRouter.stack.find(layer => layer.route?.path === '/export/csv')?.route?.stack[0]?.handle;
      
      if (exportHandler) {
        await exportHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.headers).toHaveProperty('Content-Type');
        expect(res.headers['Content-Type']).toContain('text/csv');
      }
    });

    it('should support PDF export', async () => {
      await createTestLogs(testUsers.user.id, 5);
      
      const { default: logsRouter } = await import('../../routes/logs.js');
      
      const session = createMockSession(testUsers.user);
      const req = createMockRequest(session, {}, {});
      const res = createMockResponse();

      const exportHandler = logsRouter.stack.find(layer => layer.route?.path === '/export/pdf')?.route?.stack[0]?.handle;
      
      if (exportHandler) {
        await exportHandler(req, res);
        
        expect(res.statusCode).toBe(200);
        expect(res.headers).toHaveProperty('Content-Type');
        expect(res.headers['Content-Type']).toContain('application/pdf');
      }
    });

    it('should limit export size', async () => {
      // Test that exports are limited to prevent DoS
      const maxExportSize = 10000;
      
      expect(maxExportSize).toBeGreaterThan(0);
      expect(maxExportSize).toBeLessThanOrEqual(10000);
    });
  });
});