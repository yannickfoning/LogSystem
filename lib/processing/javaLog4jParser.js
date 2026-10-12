/**
 * Java Log4j Parser with Multi-line Support
 * Handles stack traces and WARN → WARNING normalization
 * Optimized for large files (500K+ lines, 100MB+)
 */

import logger from '../../config/logger.js';
import { normalizeJavaLog4jTimestamp, parseJavaLog4jLine } from './javaLog4jFormat.js';

// Stack trace line pattern (lines that continue a log entry)
const STACK_TRACE_PATTERN = /^\s+at\s+|^Caused by:/;

export function parseJavaLog4jStream(buffer, opts = {}) {
  const {
    source = null,
    service = 'java',
    maxFileSize = 100 * 1024 * 1024, // 100MB default
    maxLines = 1000000 // 1M lines default
  } = opts;

  const text = buffer.toString('utf8');
  const lines = text.split('\n');
  
  // Validate file size
  if (buffer.length > maxFileSize) {
    throw new Error(`File too large: ${buffer.length} bytes (max ${maxFileSize})`);
  }
  
  // Validate line count
  if (lines.length > maxLines) {
    throw new Error(`Too many lines: ${lines.length} (max ${maxLines})`);
  }

  const logs = [];
  let currentLog = null;
  let lineNumber = 0;

  for (const line of lines) {
    lineNumber++;
    
    if (!line.trim()) {
      // Empty line completes current log if exists
      if (currentLog) {
        logs.push(currentLog);
        currentLog = null;
      }
      continue;
    }

    const parsed = parseJavaLog4jLine(line);

    if (parsed) {
      // New log entry starts - complete previous one
      if (currentLog) {
        logs.push(currentLog);
      }

      currentLog = {
        raw_log: line,
        timestamp: normalizeJavaLog4jTimestamp(parsed.timestamp),
        created_time: parsed.timestamp.split(/[ T]/)[1] || null,
        log_level: parsed.level,
        module: parsed.logger || parsed.thread,
        thread: parsed.thread,
        message: parsed.message,
        service: service,
        source: source,
        stack_trace: null,
        line_number: lineNumber
      };
    } else if (currentLog && STACK_TRACE_PATTERN.test(line)) {
      // Continuation line (stack trace)
      if (!currentLog.stack_trace) {
        currentLog.stack_trace = line;
      } else {
        currentLog.stack_trace += '\n' + line;
      }
      // Also append to message for full context
      currentLog.message += '\n' + line;
    } else if (currentLog) {
      // Continuation line without stack trace pattern
      currentLog.message += '\n' + line;
    }
  }

  // Don't forget the last log
  if (currentLog) {
    logs.push(currentLog);
  }

  logger.info({ 
    event: 'java_log4j_parsed', 
    totalLogs: logs.length, 
    totalLines: lineNumber,
    format: 'java-log4j' 
  }, '[PARSER]');

  return logs;
}

export function parseJavaLog4jBatch(buffer, opts = {}) {
  // For smaller files, use simpler batch approach
  const logs = parseJavaLog4jStream(buffer, opts);
  
  // Return in batches for memory efficiency
  const batchSize = opts.batchSize || 1000;
  const batches = [];
  
  for (let i = 0; i < logs.length; i += batchSize) {
    batches.push(logs.slice(i, i + batchSize));
  }
  
  return {
    logs,
    batches,
    totalLogs: logs.length,
    totalBatches: batches.length
  };
}

export function detectJavaLog4jFormat(buffer) {
  const text = buffer.toString('utf8');
  const sampleLines = text.split('\n').slice(0, 20);
  
  let matchCount = 0;
  for (const line of sampleLines) {
    if (parseJavaLog4jLine(line)) {
      matchCount++;
    }
  }
  
  // If more than 50% of sample lines match, it's Java Log4j
  return matchCount > (sampleLines.length / 2);
}

export default {
  parseJavaLog4jStream,
  parseJavaLog4jBatch,
  detectJavaLog4jFormat
};
