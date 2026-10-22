import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { parseLogContent } from '../lib/processing/universalParser.js';

describe('line-oriented log streaming', () => {
  it('parses JSONL across arbitrary stream chunk boundaries in bounded batches', async () => {
    const source = Buffer.from([
      '{"timestamp":"2026-10-01T10:00:00Z","level":"INFO","message":"first"}',
      '{"timestamp":"2026-10-01T10:00:01Z","level":"ERROR","message":"second"}',
      '{"timestamp":"2026-10-01T10:00:02Z","level":"WARN","message":"third"}',
    ].join('\n'));
    const batches = [];
    const readable = Readable.from([
      source.subarray(0, 17),
      source.subarray(17, 64),
      source.subarray(64),
    ]);

    await parseLogContent(readable, 'jsonl', {
      batchSize: 2,
      onBatch: async batch => batches.push(batch),
    });

    expect(batches.map(batch => batch.length)).toEqual([2, 1]);
    expect(batches.flat().map(log => log.message)).toEqual(['first', 'second', 'third']);
  });

  it('reuses a CSV header across streamed batches', async () => {
    const readable = Readable.from([
      Buffer.from('timestamp,level,message\n2026-10-01T10:00:00Z,INFO,first\n'),
      Buffer.from('2026-10-01T10:00:01Z,ERROR,second\n2026-10-01T10:00:02Z,WARN,third'),
    ]);
    const batches = [];

    await parseLogContent(readable, 'csv', {
      batchSize: 2,
      onBatch: async batch => batches.push(batch),
    });

    expect(batches.map(batch => batch.length)).toEqual([2, 1]);
    expect(batches.flat().map(log => log.message)).toEqual(['first', 'second', 'third']);
  });
});
