/**
 * Archive decompression utility
 * Supports: ZIP, GZIP, TAR, TAR+GZIP
 */

import decompress from 'decompress';
import zlib from 'zlib';
import { promisify } from 'util';
import unzipper from 'unzipper';
import logger from '../../config/logger.js';

const gunzip = promisify(zlib.gunzip);

/**
 * Detect archive type from filename or magic bytes
 */
export function detectArchiveType(filename, buffer) {
  const name = (filename || '').toLowerCase();
  
  // Check extension first
  if (name.endsWith('.zip')) return 'zip';
  if (name.endsWith('.tar.gz') || name.endsWith('.tgz')) return 'targz';
  if (name.endsWith('.gz') || name.endsWith('.gzip')) return 'gzip';

  if (name.endsWith('.brotli') || name.endsWith('.br')) return 'brotli';
  if (name.endsWith('.zst') || name.endsWith('.zstandard')) return 'zstandard';
  if (name.endsWith('.tar')) return 'tar';
  
  // Check magic bytes
  if (buffer && buffer.length >= 2) {
    const magic = buffer.slice(0, 4);
    
    // ZIP: 0x50 0x4B 0x03 0x04
    if (magic[0] === 0x50 && magic[1] === 0x4B && magic[2] === 0x03 && magic[3] === 0x04) {
      return 'zip';
    }
    
    // GZIP: 0x1F 0x8B
    if (magic[0] === 0x1F && magic[1] === 0x8B) {
      return 'gzip';
    }
    
    // Zstandard: 0x28 0xB5 0x2F 0xFD
    if (magic[0] === 0x28 && magic[1] === 0xB5 && magic[2] === 0x2F && magic[3] === 0xFD) {
      return 'zstandard';
    }
    
    // Brotli detection is harder, usually has .br or .brotli extension
  }
  
  return null;
}

/**
 * Decompress archive and extract log files
 * Returns array of {filename, content} objects
 */
export async function extractArchive(buffer, filename, maxExtractSize = 1073741824) { // 1GB
  const archiveType = detectArchiveType(filename, buffer);
  
  if (!archiveType) {
    throw new Error(`Unknown archive type for ${filename}`);
  }
  
  logger.info({ event: 'archive_detected', archiveType, filename }, '[ARCHIVE]');
  
  const files = [];
  let totalSize = 0;
  
  try {
    switch (archiveType) {
      case 'zip':
        return await extractZip(buffer, maxExtractSize);
      
      case 'gzip':
        return await extractGzip(buffer, maxExtractSize);
      
      case 'brotli':
        return await extractBrotli(buffer, maxExtractSize);
      
      case 'zstandard':
        return await extractZstandard(buffer, maxExtractSize);
      
      case 'tar':
      case 'targz':
        return await extractTar(buffer, maxExtractSize);
      
      default:
        throw new Error(`Unsupported archive type: ${archiveType}`);
    }
  } catch (e) {
    logger.error({ event: 'archive_extraction_failed', archiveType, filename, error: e.message }, '[ARCHIVE]');
    throw new Error(`Failed to extract ${archiveType} archive: ${e.message}`);
  }
}

/**
 * Extract ZIP archive
 */
async function extractZip(buffer, maxSize) {
  const files = [];
  let totalSize = 0;
  
  return new Promise((resolve, reject) => {
    const unzipStream = unzipper.Parse();
    let pendingEntries = 0;
    
    unzipStream.on('entry', async (entry) => {
      const { path: filename, type } = entry;
      
      if (type !== 'File') {
        entry.autodrain();
        return;
      }
      
      // Skip hidden files and common binary files
      if (filename.startsWith('.') || 
          filename.match(/\.(exe|dll|so|dylib|bin|jpg|png|gif|zip)$/i)) {
        entry.autodrain();
        return;
      }
      
      pendingEntries++;
      const chunks = [];
      
      entry.on('data', chunk => {
        chunks.push(chunk);
        totalSize += chunk.length;
        if (totalSize > maxSize) {
          entry.destroy();
          unzipStream.destroy();
          reject(new Error(`Archive too large (> ${maxSize} bytes)`));
        }
      });
      
      entry.on('end', () => {
        files.push({
          filename: filename,
          content: Buffer.concat(chunks)
        });
        pendingEntries--;
        if (pendingEntries === 0 && !unzipStream.readable) {
          resolve(files);
        }
      });
      
      entry.on('error', reject);
    });
    
    unzipStream.on('end', () => {
      if (pendingEntries === 0) {
        resolve(files);
      }
    });
    
    unzipStream.on('error', reject);
    
    unzipStream.write(buffer);
    unzipStream.end();
  });
}

/**
 * Extract GZIP archive
 */
async function extractGzip(buffer, maxSize) {
  const decompressed = await gunzip(buffer);
  
  if (decompressed.length > maxSize) {
    throw new Error(`Decompressed size too large (> ${maxSize} bytes)`);
  }
  
  return [{
    filename: 'decompressed.log',
    content: decompressed
  }];
}

/**
 * Extract Brotli compressed archive
 */
async function extractBrotli(buffer, maxSize) {
  throw new Error('Brotli decompression is not supported. Please use .gz (gzip) or .zip archives instead');
}

/**
 * Extract Zstandard compressed archive
 */
async function extractZstandard(buffer, maxSize) {
  throw new Error('Zstandard decompression is not supported. Please use .gz (gzip) or .zip archives instead');
}

/**
 * Extract TAR archive
 */
async function extractTar(buffer, maxSize) {
  try {
    const files = await decompress(Buffer.from(buffer), '.');
    
    const results = [];
    for (const file of files) {
      if (file.type !== 'file') continue;
      
      results.push({
        filename: file.path,
        content: file.data
      });
    }
    
    return results;
  } catch (e) {
    throw new Error(`TAR extraction failed: ${e.message}`);
  }
}

/**
 * Check if buffer is a compressed archive
 */
export function isArchive(filename) {
  return detectArchiveType(filename) !== null;
}

export default { extractArchive, detectArchiveType, isArchive };
