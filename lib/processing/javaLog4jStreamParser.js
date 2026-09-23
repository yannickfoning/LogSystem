/**
 * Streaming Java Log4j Parser for Large Files
 * Handles 500K+ lines, 100MB+ files without loading entire file in memory
 * Uses readline streams for memory efficiency
 */

import readline from 'readline';
import { Readable } from 'stream';
import logger from '../../config/logger.js';
import { normalizeLevel } from '../../services/logLevelUtils.js';

// Inline timestamp normalization for Java Log4j format
function normalizeTimestamp(timestampStr, locale = 'fr') {
  if (!timestampStr) return null;
  const str = String(timestampStr).trim();

  try {
    // Java Log4j format: 2026-05-18 00:02:56,879
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2},\d{3}$/.test(str)) {
      const date = new Date(str.replace(',', '.'));
      if (!isNaN(date.getTime())) {
        return date.toISOString().slice(0, 19).replace('T', ' ');
      }
    }

    // Fallback to standard parsing
    const date = new Date(str);
    if (!isNaN(date.getTime())) {
      return date.toISOString().slice(0, 19).replace('T', ' ');
    }

    return null;
  } catch (_e) {
    return null;
  }
}

// Java Log4j pattern: 2026-05-18 00:02:56,879 ERROR [com.sit.pps.ep.pub.service.impl.EpPubServiceImpl] Error setting null for parameter...
const JAVA_LOG4J_PATTERN = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3})\s+(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\s+\[([^\]]+)\]\s+(.*)$/;

// Stack trace line pattern (lines that continue a log entry)
const STACK_TRACE_PATTERN = /^\s+at\s+|^Caused by:/;

/**
 * Parse Java Log4j file using streaming approach
 * @param {Buffer} buffer - File content as buffer
 * @param {Object} opts - Options { source, service, locale, batchSize, onBatch }
 * @returns {Promise<Object>} { totalLogs, stats }
 */
export async function parseJavaLog4jStream(buffer, opts = {}) {
  const {
    source = null,
    service = 'java',
    locale = 'fr',
    batchSize = 1000,
    onBatch = null // Callback for each batch: (batch) => Promise<void>
  } = opts;

  return new Promise((resolve, reject) => {
    const stream = Readable.from(buffer);
    const rl = readline.createInterface({
      input: stream,
      crlfDelay: Infinity
    });

    let currentLog = null;
    let batch = [];
    let lineNumber = 0;
    let totalLogs = 0;
    let stats = {
      totalLines: 0,
      totalLogs: 0,
      stackTraceCount: 0,
      warnCount: 0,
      errorCount: 0,
      debugCount: 0,
      infoCount: 0
    };

    rl.on('line', async (line) => {
      lineNumber++;
      stats.totalLines++;

      if (!line.trim()) {
        // Empty line completes current log if exists
        if (currentLog) {
          batch.push(currentLog);
          stats.totalLogs++;
          updateLevelStats(currentLog.log_level, stats);
          currentLog = null;

          // Process batch if full
          if (batch.length >= batchSize) {
            if (onBatch) {
              try {
                const batchCopy = [...batch];
                batch = []; // Clear before callback to avoid accumulation
                await onBatch(batchCopy);
              } catch (err) {
                logger.error({ event: 'batch_callback_error', error: err.message }, '[STREAM_PARSER]');
              }
            } else {
              batch = [];
            }
          }
        }
        return;
      }

      const match = line.match(JAVA_LOG4J_PATTERN);

      if (match) {
        // New log entry starts - complete previous one
        if (currentLog) {
          batch.push(currentLog);
          stats.totalLogs++;
          updateLevelStats(currentLog.log_level, stats);
          currentLog = null;

          // Process batch if full
          if (batch.length >= batchSize) {
            if (onBatch) {
              try {
                const batchCopy = [...batch];
                batch = []; // Clear before callback to avoid accumulation
                await onBatch(batchCopy);
              } catch (err) {
                logger.error({ event: 'batch_callback_error', error: err.message }, '[STREAM_PARSER]');
              }
            } else {
              batch = [];
            }
          }
        }

        const [, timestampStr, level, loggerName, message] = match;

        // Normalize WARN → WARNING
        const normalizedLevel = level === 'WARN' ? 'WARNING' : level.toUpperCase();

        currentLog = {
          raw_log: line,
          timestamp: normalizeTimestamp(timestampStr, locale),
          created_time: timestampStr.split(' ')[1] || null,
          log_level: normalizedLevel,
          module: loggerName,
          message: message,
          service: service,
          source: source,
          stack_trace: null,
          line_number: lineNumber,
          timestamp_inferred: false
        };
      } else if (currentLog && STACK_TRACE_PATTERN.test(line)) {
        // Continuation line (stack trace)
        if (!currentLog.stack_trace) {
          currentLog.stack_trace = line;
          stats.stackTraceCount++;
        } else {
          currentLog.stack_trace += '\n' + line;
        }
        // Also append to message for full context
        currentLog.message += '\n' + line;
      } else if (currentLog) {
        // Continuation line without stack trace pattern
        currentLog.message += '\n' + line;
      }
    });

    rl.on('close', async () => {
      // Don't forget the last log
      if (currentLog) {
        batch.push(currentLog);
        stats.totalLogs++;
        updateLevelStats(currentLog.log_level, stats);
      }

      // Process final batch
      if (batch.length > 0 && onBatch) {
        try {
          const batchCopy = [...batch];
          batch = []; // Clear before callback
          await onBatch(batchCopy);
        } catch (err) {
          logger.error({ event: 'final_batch_callback_error', error: err.message }, '[STREAM_PARSER]');
        }
      }

      logger.info({
        event: 'java_log4j_stream_parsed',
        totalLogs: stats.totalLogs,
        totalLines: stats.totalLines,
        stats: stats,
        format: 'java-log4j-stream'
      }, '[STREAM_PARSER]');

      resolve({ totalLogs: stats.totalLogs, stats });
    });

    rl.on('error', (err) => {
      logger.error({ event: 'stream_error', error: err.message }, '[STREAM_PARSER]');
      reject(err);
    });
  });
}

function updateLevelStats(level, stats) {
  switch (level) {
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
    if (JAVA_LOG4J_PATTERN.test(line)) {
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
