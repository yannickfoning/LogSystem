import { describe, expect, it } from 'vitest';
import { detectFormat, parseLogContent } from '../lib/processing/universalParser.js';
import { parseJavaLog4jStream } from '../lib/processing/javaLog4jStreamParser.js';
import { enrichLogMetadata } from '../lib/processing/logMetadata.js';

describe('Java Log4j complete parsing', () => {
  it('keeps a generic timestamped text log out of the Java parser', async () => {
    const buffer = Buffer.from('2026-10-05 08:00:00 INFO Service started\n');

    expect(detectFormat(buffer)).toBe('text');
    const parsed = await parseLogContent(buffer);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].parser_format).toBe('text');
    expect(parsed[0].log_level).toBe('INFO');
  });

  it.each([
    ['dot milliseconds', '2026-10-05 08:00:00.123 ERROR [com.example.Service] failed'],
    ['comma milliseconds', '2026-10-05 08:00:00,123 ERROR [com.example.Service] failed'],
    ['thread before level', '2026-10-05 08:00:00.123 [worker-1] CRITICAL [com.example.Service] failed'],
    ['no milliseconds', '2026-10-05 08:00:00 WARNING [com.example.Service] failed'],
  ])('parses %s without dropping the record', async (_name, line) => {
    const buffer = Buffer.from(`${line}\n`);
    const format = detectFormat(buffer);
    const parsed = await parseLogContent(buffer, format);

    expect(format).toBe('java');
    expect(parsed).toHaveLength(1);
    expect(parsed[0].message).toContain('failed');
    expect(parsed[0].timestamp).not.toBeNull();
  });

  it.each([
    ['dot-qualified user id', '2026-10-05 08:00:00.123 ERROR [com.example.Service] audit.USER_ID=uid-42', 'uid-42'],
    ['dot-qualified actor', '2026-10-05 08:00:00.123 ERROR [com.example.Service] request.actor=operator-7', 'operator-7'],
  ])('extracts %s from a message', async (_name, line, expectedActor) => {
    const parsed = await parseLogContent(Buffer.from(`${line}\n`), 'java');

    expect(parsed).toHaveLength(1);
    expect(parsed[0].target_user).toBe(expectedActor);
  });

  it('uses a parsed component as the specific service when no service field exists', () => {
    const enriched = enrichLogMetadata({
      message: 'request failed',
      module: 'com.example.BillingService',
      service: null,
      parser_format: 'text',
    }, { format: 'text' });

    expect(enriched.service).toBe('BillingService');
    expect(enriched.source).toBe('com.example.BillingService');
  });

  it('parses a dot-millisecond file above the streaming threshold in every batch', async () => {
    const threshold = 10 * 1024 * 1024;
    const line = Buffer.from('2026-10-05 08:00:00.123 ERROR [com.example.Service] large-file probe\n');
    const lineCount = Math.ceil((threshold + 1) / line.length);
    const buffer = Buffer.alloc(line.length * lineCount);
    for (let index = 0; index < lineCount; index++) line.copy(buffer, index * line.length);

    expect(buffer.length).toBeGreaterThan(threshold);
    expect(detectFormat(buffer)).toBe('java');

    const firstPass = await parseJavaLog4jStream(buffer, { batchSize: 500 });
    let parsedCount = 0;
    let batchCount = 0;
    await parseLogContent(buffer, 'java', {
      batchSize: 500,
      onBatch: async batch => {
        parsedCount += batch.length;
        batchCount++;
      },
    });

    expect(firstPass.totalLogs).toBe(lineCount);
    expect(parsedCount).toBe(firstPass.totalLogs);
    expect(batchCount).toBe(Math.ceil(lineCount / 500));
  });
});
