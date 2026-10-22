/**
 * Streaming Java Log4j Parser for Large Files
 * Handles 500K+ lines, 100MB+ files without loading entire file in memory
 * Uses readline streams for memory efficiency
 */

import readline from 'readline';
import { Readable } from 'stream';
import logger from '../../config/logger.js';
import { normalizeJavaLog4jTimestamp, parseJavaLog4jLine } from './javaLog4jFormat.js';

// Stack trace line pattern (lines that continue a log entry)
const STACK_TRACE_PATTERN = /^\s+at\s+|^Caused by:/;

/**
 * Parse Java Log4j file using streaming approach
 * @param {Buffer|Readable} buffer - File content or a readable stream
 * @param {Object} opts - Options { source, service, locale, batchSize, onBatch }
 * @returns {Promise<Object>} { totalLogs, stats }
 */
export async function parseJavaLog4jStream(buffer, opts = {}) {
  const {
    source = null,
    service = 'java',
    batchSize = 1000,
    onBatch = null // Callback for each batch: (batch) => Promise<void>
  } = opts;

  const stream = buffer && typeof buffer.pipe === 'function'
    ? buffer
    : Readable.from([buffer]);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const safeBatchSize = Math.max(1, Number(batchSize) || 1000);
  let currentLog = null;
  let batch = [];
  let lineNumber = 0;
  const stats = {
    totalLines: 0,
    totalLogs: 0,
    stackTraceCount: 0,
    traceCount: 0,
    warnCount: 0,
    errorCount: 0,
    debugCount: 0,
    infoCount: 0,
    criticalCount: 0,
    fatalCount: 0,
  };

  const emitLog = async log => {
    batch.push(log);
    stats.totalLogs++;
    updateLevelStats(log.log_level, stats);
    if (batch.length >= safeBatchSize) {
      const completedBatch = batch;
      batch = [];
      if (onBatch) await onBatch(completedBatch);
    }
  };

  try {
    // Async iteration applies back-pressure while the importer commits each batch.
    for await (const line of rl) {
      lineNumber++;
      stats.totalLines++;

      if (!line.trim()) {
        if (currentLog) {
          await emitLog(currentLog);
          currentLog = null;
        }
        continue;
      }

      const parsed = parseJavaLog4jLine(line);
      if (parsed) {
        if (currentLog) await emitLog(currentLog);

        currentLog = {
          raw_log: line,
          timestamp: normalizeJavaLog4jTimestamp(parsed.timestamp),
          created_time: parsed.timestamp.split(/[ T]/)[1] || null,
          log_level: parsed.level,
          module: parsed.logger || parsed.thread,
          thread: parsed.thread,
          message: parsed.message,
          service,
          source,
          stack_trace: null,
          line_number: lineNumber,
          timestamp_inferred: false,
        };
      } else if (currentLog && STACK_TRACE_PATTERN.test(line)) {
        if (!currentLog.stack_trace) {
          currentLog.stack_trace = line;
          stats.stackTraceCount++;
        } else {
          currentLog.stack_trace += '\n' + line;
        }
        currentLog.message += '\n' + line;
      } else if (currentLog) {
        currentLog.message += '\n' + line;
      }
    }

    if (currentLog) await emitLog(currentLog);
    if (batch.length && onBatch) await onBatch(batch);
  } catch (err) {
    rl.close();
    stream.destroy();
    logger.error({ event: 'stream_parse_or_batch_error', error: err.message }, '[STREAM_PARSER]');
    throw err;
  }

  logger.info({
    event: 'java_log4j_stream_parsed',
    totalLogs: stats.totalLogs,
    totalLines: stats.totalLines,
    stats,
    format: 'java-log4j-stream',
  }, '[STREAM_PARSER]');

  return { totalLogs: stats.totalLogs, stats };
}

function updateLevelStats(level, stats) {
  switch (level) {
    case 'TRACE':
      stats.traceCount++;
      break;
    case 'DEBUG':
      stats.debugCount++;
      break;
    case 'INFO':
      stats.infoCount++;
      break;
    case 'WARNING':
      stats.warnCount++;
      break;
    case 'ERROR':
      stats.errorCount++;
      break;
    case 'CRITICAL':
      stats.criticalCount++;
      break;
    case 'FATAL':
      stats.fatalCount++;
      break;
  }
}

/**
 * Detect if buffer contains Java Log4j format
 * Optimized to only read first 10KB
 */
export function detectJavaLog4jFormat(buffer) {
  const sampleSize = Math.min(buffer.length, 10240);
  const sample = buffer.slice(0, sampleSize).toString('utf8');
  const sampleLines = sample.split('\n').slice(0, 20);

  let matchCount = 0;
  for (const line of sampleLines) {
    if (parseJavaLog4jLine(line)) {
      matchCount++;
    }
  }

  // If more than 30% of sample lines match, it's Java Log4j (lowered threshold for files with stack traces)
  return matchCount > (sampleLines.length * 0.3);
}

export default {
  parseJavaLog4jStream,
  detectJavaLog4jFormat
};
