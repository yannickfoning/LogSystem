/**
 * Java Log4j Parser with Multi-line Support
 * Handles stack traces and WARN → WARNING normalization
 * Optimized for large files (500K+ lines, 100MB+)
 */

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
const JAVA_LOG4J_PATTERN = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3})\s+(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\s+\[([^\]]+)\]\s(.*)$/;

// Stack trace line pattern (lines that continue a log entry)
const STACK_TRACE_PATTERN = /^\s+at\s+|^Caused by:/;

export function parseJavaLog4jStream(buffer, opts = {}) {
  const {
    source = null,
    service = 'java',
    locale = 'fr',
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

    const match = line.match(JAVA_LOG4J_PATTERN);
    
    if (match) {
      // New log entry starts - complete previous one
      if (currentLog) {
        logs.push(currentLog);
      }

      const [, timestampStr, level, logger, message] = match;
      
      // Normalize WARN → WARNING
      const normalizedLevel = level === 'WARN' ? 'WARNING' : level.toUpperCase();
      
      currentLog = {
        raw_log: line,
        timestamp: normalizeTimestamp(timestampStr, locale),
        created_time: timestampStr.split(' ')[1] || null,
        log_level: normalizedLevel,
        module: logger,
        message: message,
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
    if (JAVA_LOG4J_PATTERN.test(line)) {
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
