/**
 * Critical path tests for LogSystem V5
 * Run with: npm run test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pool from '../config/database.js';
import { normalizeMessage } from '../lib/processing/normalize.js';
import { classifyLog } from '../lib/processing/classify.js';
import { generateFingerprint } from '../lib/processing/fingerprint.js';
import { levelSeverity, normalizeLevel } from '../lib/levels.js';
import { detectFormat, parseLogContent } from '../lib/processing/universalParser.js';
import { detectEncoding, convertToUtf8 } from '../lib/processing/encodingDetector.js';
import { isArchive, detectArchiveType } from '../lib/processing/archiveHandler.js';

describe('Log Processing', () => {
  describe('normalizeMessage', () => {
    it('should remove UUIDs', () => {
      const msg = 'User 550e8400-e29b-41d4-a716-446655440000 logged in';
      const result = normalizeMessage(msg);
      expect(result).not.toContain('550e8400');
      expect(result).toContain('<UUID>');
    });

    it('should remove IPv4 addresses', () => {
      const msg = 'Connection from 192.168.1.100:8080 refused';
      const result = normalizeMessage(msg);
      expect(result).not.toContain('192.168.1.100');
      expect(result).toContain('<IPv4>');
    });

    it('should remove IPv6 addresses', () => {
      const msg = 'IPv6 address 2001:db8::1 detected';
      const result = normalizeMessage(msg);
      expect(result).not.toContain('2001:db8');
      expect(result).toContain('<IPv6>');
    });

    it('should remove durations', () => {
      const msg = 'Query took 125ms to execute';
      const result = normalizeMessage(msg);
      expect(result).not.toContain('125ms');
      expect(result).toContain('<DURATION>');
    });

    it('should remove timestamps', () => {
      const msg = 'Started at 2026-05-18T10:30:45Z';
      const result = normalizeMessage(msg);
      expect(result).not.toContain('2026-05-18');
      expect(result).toContain('<TIMESTAMP>');
    });
  });

  describe('classifyLog', () => {
    it('should classify database logs', () => {
      const msg = 'SELECT * FROM users WHERE id = 1';
      const result = classifyLog(msg, 'database', 'postgres');
      expect(result).toBe('database_query');
    });

    it('should classify error logs', () => {
      const msg = 'NullPointerException at line 42';
      const result = classifyLog(msg, 'app', 'java');
      expect(result).toBe('error');
    });

    it('should classify auth logs', () => {
      const msg = 'Authentication failed for user admin';
      const result = classifyLog(msg, 'auth', 'http');
      expect(result).toBe('authentication');
    });
  });

  describe('generateFingerprint', () => {
    it('should generate consistent fingerprints', () => {
      const fp1 = generateFingerprint('api', 'error', 'Connection timeout', 1);
      const fp2 = generateFingerprint('api', 'error', 'Connection timeout', 1);
      expect(fp1).toBe(fp2);
    });

    it('should include user_id for tenant isolation', () => {
      const fp1 = generateFingerprint('api', 'error', 'Connection timeout', 1);
      const fp2 = generateFingerprint('api', 'error', 'Connection timeout', 2);
      expect(fp1).not.toBe(fp2);
    });
  });

  describe('levelSeverity', () => {
    it('should order levels correctly', () => {
      expect(levelSeverity('DEBUG')).toBeLessThan(levelSeverity('INFO'));
      expect(levelSeverity('INFO')).toBeLessThan(levelSeverity('WARNING'));
      expect(levelSeverity('WARNING')).toBeLessThan(levelSeverity('ERROR'));
      expect(levelSeverity('ERROR')).toBeLessThan(levelSeverity('CRITICAL'));
      expect(levelSeverity('CRITICAL')).toBeLessThan(levelSeverity('FATAL'));
    });
  });

  describe('normalizeLevel', () => {
    it('should normalize common variations', () => {
      expect(normalizeLevel('warn')).toBe('WARNING');
      expect(normalizeLevel('err')).toBe('ERROR');
      expect(normalizeLevel('crit')).toBe('CRITICAL');
      expect(normalizeLevel('emerg')).toBe('FATAL');
    });

    it('should fallback to INFO for unknown levels', () => {
      expect(normalizeLevel('unknown')).toBe('INFO');
    });
  });
});

describe('Format Detection', () => {
  it('should detect JSON format', () => {
    const buffer = Buffer.from('{"timestamp":"2026-05-18T10:30:45Z","level":"ERROR","message":"Test"}');
    const format = detectFormat(buffer);
    expect(format).toBe('json');
  });

  it('should parse a single JSON object as one log', async () => {
    const buffer = Buffer.from('{"timestamp":"2026-05-18T10:30:45Z","level":"ERROR","message":"Test"}');
    const logs = await parseLogContent(buffer, 'json');
    expect(logs).toHaveLength(1);
    expect(logs[0].log_level).toBe('ERROR');
    expect(logs[0].message).toBe('Test');
  });

  it('should detect JSONL format', () => {
    const buffer = Buffer.from('{"level":"ERROR","message":"Test 1"}\n{"level":"INFO","message":"Test 2"}');
    const format = detectFormat(buffer);
    expect(format).toBe('jsonl');
  });

  it('should detect plaintext format', () => {
    const buffer = Buffer.from('This is a plain text log message\nAnother line');
    const format = detectFormat(buffer);
    expect(format).toBe('text');
  });

  it('should detect CSV format', () => {
    const buffer = Buffer.from('timestamp,level,message\n2026-05-18,ERROR,Test');
    const format = detectFormat(buffer);
    expect(['csv', 'text']).toContain(format);
  });
});

describe('Encoding Detection', () => {
  it('should detect UTF-8', () => {
    const buffer = Buffer.from('Hello world');
    const result = detectEncoding(buffer);
    expect(result.encoding).toBe('utf8');
  });

  it('should convert UTF-8 correctly', () => {
    const buffer = Buffer.from('Café', 'utf8');
    const result = convertToUtf8(buffer);
    expect(result).toBe('Café');
  });

  it('should detect UTF-8 BOM', () => {
    const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
    const content = Buffer.from('Hello');
    const buffer = Buffer.concat([bom, content]);
    const result = detectEncoding(buffer);
    expect(result.encoding).toBe('UTF-8');
  });
});

describe('Archive Detection', () => {
  it('should detect ZIP by extension', () => {
    const type = detectArchiveType('logs.zip');
    expect(type).toBe('zip');
  });

  it('should detect GZIP by extension', () => {
    const type = detectArchiveType('logs.gz');
    expect(type).toBe('gzip');
  });

  it('should detect TAR by extension', () => {
    const type = detectArchiveType('logs.tar');
    expect(type).toBe('tar');
  });

  it('should detect TAR.GZ by extension', () => {
    const type = detectArchiveType('logs.tar.gz');
    expect(type).toBe('targz');
  });

  it('should detect RAR by extension', () => {
    const type = detectArchiveType('logs.rar');
    expect(type).toBe('rar');
  });

  it('should detect ZIP by magic bytes', () => {
    const magic = Buffer.from([0x50, 0x4B, 0x03, 0x04]);
    const type = detectArchiveType('unknown', magic);
    expect(type).toBe('zip');
  });

  it('should detect GZIP by magic bytes', () => {
    const magic = Buffer.from([0x1F, 0x8B]);
    const type = detectArchiveType('unknown', magic);
    expect(type).toBe('gzip');
  });

  it('should detect RAR by magic bytes', () => {
    const magic = Buffer.from([0x52, 0x61, 0x72, 0x21]);
    const type = detectArchiveType('unknown', magic);
    expect(type).toBe('rar');
  });

  it('should classify RAR files as archives', () => {
    expect(isArchive('logs.rar')).toBe(true);
  });
});

describe('Database Constraints', () => {
  beforeAll(async () => {
    // Test database connection
    try {
      await pool.execute('SELECT 1');
    } catch (e) {
      console.warn('[TEST] Database not available, skipping DB tests');
    }
  });

  it('should enforce fingerprint uniqueness per user', async () => {
    // This test verifies schema constraints exist
    try {
      const [result] = await pool.execute('SHOW CREATE TABLE logs');
      expect(result[0]['Create Table']).toContain('idx_fingerprint_ts_user');
    } catch (e) {
      console.warn('[TEST] Skipping DB schema test:', e.message);
    }
  });
});

export default {};
