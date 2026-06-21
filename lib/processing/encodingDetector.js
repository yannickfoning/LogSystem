/**
 * File encoding detection utility
 * Detects encoding of log files (UTF-8, UTF-16, ISO-8859-1, CP1252, etc.)
 */

import iconv from 'iconv-lite';
import logger from '../../config/logger.js';

// Magic bytes for encoding detection
const ENCODING_SIGNATURES = [
  { bytes: [0xFF, 0xFE, 0x00, 0x00], encoding: 'UTF-32LE', name: 'UTF-32 (Little Endian)' },
  { bytes: [0x00, 0x00, 0xFE, 0xFF], encoding: 'UTF-32BE', name: 'UTF-32 (Big Endian)' },
  { bytes: [0xEF, 0xBB, 0xBF], encoding: 'UTF-8', name: 'UTF-8 with BOM' },
  { bytes: [0xFF, 0xFE], encoding: 'UTF-16LE', name: 'UTF-16 (Little Endian)' },
  { bytes: [0xFE, 0xFF], encoding: 'UTF-16BE', name: 'UTF-16 (Big Endian)' },
];

/**
 * Detect encoding from buffer
 * Returns array of [encoding, confidence, detected]
 */
export function detectEncoding(buffer, maxBytes = 32768) {
  const sample = buffer.slice(0, maxBytes);
  
  // Check for BOM
  for (const sig of ENCODING_SIGNATURES) {
    if (sample.length >= sig.bytes.length) {
      let match = true;
      for (let i = 0; i < sig.bytes.length; i++) {
        if (sample[i] !== sig.bytes[i]) {
          match = false;
          break;
        }
      }
      if (match) {
        return {
          encoding: sig.encoding,
          confidence: 1.0,
          detected: sig.name
        };
      }
    }
  }
  
  // Statistical analysis
  const results = [];
  const commonEncodings = [
    'utf8',
    'utf16le',
    'utf16be',
    'iso88591',  // Latin-1
    'cp1252',    // Windows-1252
    'gb2312',    // Chinese
    'gbk',       // Chinese
    'shift_jis', // Japanese
    'euc_jp',    // Japanese
  ];
  
  // UTF-8 validation
  try {
    let utf8Errors = 0;

    // Check for valid UTF-8 sequences
    for (let i = 0; i < sample.length; i++) {
      const byte = sample[i];
      
      if (byte < 0x80) continue;
      
      let seqLength = 0;
      if ((byte & 0xE0) === 0xC0) seqLength = 2;
      else if ((byte & 0xF0) === 0xE0) seqLength = 3;
      else if ((byte & 0xF8) === 0xF0) seqLength = 4;
      else {
        utf8Errors++;
        continue;
      }
      
      let valid = true;
      for (let j = 1; j < seqLength; j++) {
        if (i + j >= sample.length || (sample[i + j] & 0xC0) !== 0x80) {
          valid = false;
          break;
        }
      }
      
      if (!valid) utf8Errors++;
      else i += seqLength - 1;
    }
    
    const utf8Confidence = Math.max(0.9, 1.0 - (utf8Errors / (sample.length / 10)));
    results.push({
      encoding: 'utf8',
      confidence: utf8Confidence,
      errors: utf8Errors
    });
  } catch (_e) {
    // toString('utf8') does not throw in Node; kept defensively for unexpected buffer issues
  }
  
  // Try common encodings
  for (const enc of commonEncodings) {
    if (enc === 'utf8' && results.length > 0) continue;
    
    try {
      const decoded = iconv.decode(sample, enc);
      const reencoded = iconv.encode(decoded, enc);
      
      // Check if round-trip works
      let matches = 0;
      for (let i = 0; i < Math.min(reencoded.length, sample.length); i++) {
        if (reencoded[i] === sample[i]) matches++;
      }
      
      const confidence = matches / Math.max(reencoded.length, sample.length);
      if (confidence > 0.8) {
        results.push({
          encoding: enc,
          confidence: confidence
        });
      }
    } catch (_e) {
      // Encoding not supported or decoding failed
    }
  }
  
  // Sort by confidence
  results.sort((a, b) => b.confidence - a.confidence);
  
  // Default to UTF-8 if no good match
  if (results.length === 0) {
    results.push({
      encoding: 'utf8',
      confidence: 0.5,
      detected: 'Default (UTF-8 fallback)'
    });
  }
  
  return results[0];
}

/**
 * Convert buffer from detected encoding to UTF-8
 */
export function convertToUtf8(buffer) {
  try {
    // First try as UTF-8
    const str = buffer.toString('utf8');
    if (isValidUtf8(str)) {
      return str;
    }
  } catch (_e) {}
  
  // Detect encoding
  const detected = detectEncoding(buffer);
  
  try {
    if (detected.encoding === 'utf8') {
      return buffer.toString('utf8');
    }
    return iconv.decode(buffer, detected.encoding);
  } catch (e) {
    logger.warn({ event: 'encoding_decode_failed', encoding: detected.encoding, error: e.message }, '[ENCODING]');
    return buffer.toString('utf8', 0, buffer.length);
  }
}

/**
 * Check if string is valid UTF-8
 */
function isValidUtf8(str) {
  try {
    return decodeURIComponent(encodeURIComponent(str)) === str;
  } catch (_e) {
    return false;
  }
}

export default { detectEncoding, convertToUtf8 };
