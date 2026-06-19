/**
 * Archive decompression utility
 * Supports: ZIP, GZIP, TAR, TAR+GZIP, RAR
 */

import decompress from 'decompress';
import { createExtractorFromData } from 'node-unrar-js';
import zlib from 'zlib';
import { promisify } from 'util';
import unzipper from 'unzipper';
import { execFile } from 'child_process';
import { promisify as pPromisify } from 'util';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import logger from '../../config/logger.js';

const gunzip = promisify(zlib.gunzip);
const execFileAsync = pPromisify(execFile);

const SKIPPED_EXTENSIONS = new Set([
  'exe', 'dll', 'so', 'dylib', 'bin', 'jpg', 'jpeg', 'png', 'gif', 'zip', 'rar', '7z'
]);

/**
 * Detect archive type from filename or magic bytes
 */
export function detectArchiveType(filename, buffer) {
  const name = (filename || '').toLowerCase();
  
  // Check extension first
  if (name.endsWith('.zip')) return 'zip';
  if (name.endsWith('.tar.gz') || name.endsWith('.tgz')) return 'targz';
  if (name.endsWith('.gz') || name.endsWith('.gzip')) return 'gzip';
  if (name.endsWith('.rar')) return 'rar';

  if (name.endsWith('.7z')) return 'sevenzip';
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
    
    // RAR: 0x52 0x61 0x72 0x21 (Rar!)
    if (magic[0] === 0x52 && magic[1] === 0x61 && magic[2] === 0x72 && magic[3] === 0x21) {
      return 'rar';
    }
    
    // Brotli detection is harder, usually has .br or .brotli extension
    
    // 7-Zip: 0x37 0x7A 0xBC 0xAF 0x27 0x1C (7z)
    if (buffer.length >= 6 && magic[0] === 0x37 && magic[1] === 0x7A && magic[2] === 0xBC && magic[3] === 0xAF) {
      return 'sevenzip';
    }
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
      
      case 'rar':
        return await extractRar(buffer, filename, maxExtractSize);
      
      case 'sevenzip':
        return await extractSevenZip(buffer, filename, maxExtractSize);
      
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
      // [FIX-18] Path traversal protection: reject entries with ../ or absolute paths
      const normalizedFilename = path.normalize(filename).replace(/\\/g, '/');
      if (
        normalizedFilename.includes('../') ||
        path.isAbsolute(normalizedFilename) ||
        filename.startsWith('.') ||
        filename.match(/\.(exe|dll|so|dylib|bin|jpg|png|gif|zip)$/i)
      ) {
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
 * Extract RAR archive using unrar or 7z.
 * Requires one of these tools to be installed on the system.
 */
async function extractRar(buffer, filename, maxSize) {
  // Try node-unrar-js first (pure JS, no system binary needed)
  try {
    const extractor = await createExtractorFromData({ data: buffer });
    const list = extractor.getFileList();
    const fileHeaders = [...list.fileHeaders];
    const extracted = extractor.extract({ files: fileHeaders.map(h => h.name) });
    const files = [];
    let totalSize = 0;
    for (const file of extracted.files) {
      if (file.fileHeader.flags.directory) continue;
      const content = file.extraction;
      if (!content) continue;
      totalSize += content.byteLength;
      if (totalSize > maxSize) throw new Error('RAR archive exceeds maximum extraction size');
      const name = file.fileHeader.name;
      const ext = path.extname(name).slice(1).toLowerCase();
      if (!SKIPPED_EXTENSIONS.has(ext)) {
        files.push({ filename: name, content: Buffer.from(content) });
      }
    }
    logger.info({ event: 'rar_extracted_js', filename, fileCount: files.length }, '[ARCHIVE]');
    return files;
  } catch (jsErr) {
    logger.warn({ event: 'rar_js_fallback', error: jsErr.message }, '[ARCHIVE] node-unrar-js failed, trying system binary');
  }

  // Fallback: system binary (unrar / 7z)
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'logsystem-rar-'));
  const extractDir = path.join(tempRoot, 'extracted');
  const safeName = path.basename(filename || 'archive.rar').replace(/[^\w.\- ]+/g, '_') || 'archive.rar';
  const tempFile = path.join(tempRoot, safeName.endsWith('.rar') ? safeName : `${safeName}.rar`);

  try {
    await fs.mkdir(extractDir, { recursive: true });
    await fs.writeFile(tempFile, buffer);

    await runRarExtractor(tempFile, extractDir);
    
    const files = [];
    let totalSize = 0;
    const extractedFiles = await listFilesRecursive(extractDir);
    
    for (const filePath of extractedFiles) {
      const ext = path.extname(filePath).slice(1).toLowerCase();
      if (SKIPPED_EXTENSIONS.has(ext)) {
        continue;
      }

      const stat = await fs.stat(filePath);
      totalSize += stat.size;
      if (totalSize > maxSize) {
        throw new Error(`Archive too large (> ${maxSize} bytes)`);
      }
      
      const fileContent = await fs.readFile(filePath);
      
      files.push({
        filename: path.relative(extractDir, filePath).replace(/\\/g, '/'),
        content: fileContent
      });
    }
    
    return files;
  } catch (e) {
    throw new Error(`RAR extraction failed: ${e.message}`);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function runRarExtractor(archivePath, outputDir) {
  const configured = process.env.RAR_EXTRACTOR;
  const candidates = configured
    ? [{ command: configured, args: buildExtractorArgs(configured, archivePath, outputDir) }]
    : [
        { command: 'unrar', args: ['x', '-y', archivePath, outputDir] },
        { command: '7z', args: ['x', '-y', `-o${outputDir}`, archivePath] }
      ];

  const errors = [];
  for (const candidate of candidates) {
    try {
      const { stderr } = await execFileAsync(candidate.command, candidate.args, {
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 10
      });
      if (stderr && !/All OK|Everything is Ok/i.test(stderr)) {
        logger.warn({ event: 'rar_extraction_warning', command: candidate.command, stderr }, '[ARCHIVE]');
      }
      return;
    } catch (e) {
      errors.push(`${candidate.command}: ${e.message}`);
    }
  }

  throw new Error(
    `No working RAR extractor found. Install unrar or 7-Zip, or set RAR_EXTRACTOR. Tried: ${errors.join(' | ')}`
  );
}

function buildExtractorArgs(command, archivePath, outputDir) {
  const commandName = path.basename(command).toLowerCase();
  if (commandName.includes('7z')) {
    return ['x', '-y', `-o${outputDir}`, archivePath];
  }

  return ['x', '-y', archivePath, outputDir];
}

async function listFilesRecursive(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Extract 7-Zip archive using 7z command
 */
async function extractSevenZip(buffer, filename, maxSize) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'logsystem-7z-'));
  const extractDir = path.join(tempRoot, 'extracted');
  const safeName = path.basename(filename || 'archive.7z').replace(/[^\w.\- ]+/g, '_') || 'archive.7z';
  const tempFile = path.join(tempRoot, safeName.endsWith('.7z') ? safeName : `${safeName}.7z`);

  try {
    await fs.mkdir(extractDir, { recursive: true });
    await fs.writeFile(tempFile, buffer);

    // Try 7z, then 7za, then 7zz
    const candidates = [
      { command: '7z', args: ['x', '-y', `-o${extractDir}`, tempFile] },
      { command: '7za', args: ['x', '-y', `-o${extractDir}`, tempFile] },
      { command: '7zz', args: ['x', '-y', `-o${extractDir}`, tempFile] }
    ];

    let extracted = false;
    const errors = [];
    for (const candidate of candidates) {
      try {
        await execFileAsync(candidate.command, candidate.args, { windowsHide: true, maxBuffer: 1024 * 1024 * 10 });
        extracted = true;
        break;
      } catch (e) {
        errors.push(`${candidate.command}: ${e.message}`);
      }
    }

    if (!extracted) {
      throw new Error(`No working 7z extractor found. Install p7zip-full. Tried: ${errors.join(' | ')}`);
    }

    const files = [];
    let totalSize = 0;
    const extractedFiles = await listFilesRecursive(extractDir);

    for (const filePath of extractedFiles) {
      const ext = path.extname(filePath).slice(1).toLowerCase();
      if (SKIPPED_EXTENSIONS.has(ext)) continue;
      const stat = await fs.stat(filePath);
      totalSize += stat.size;
      if (totalSize > maxSize) throw new Error(`Archive too large (> ${maxSize} bytes)`);
      const fileContent = await fs.readFile(filePath);
      files.push({
        filename: path.relative(extractDir, filePath).replace(/\\/g, '/'),
        content: fileContent
      });
    }

    return files;
  } catch (e) {
    throw new Error(`7z extraction failed: ${e.message}`);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

/**
 * Check if buffer is a compressed archive
 */
export function isArchive(filename) {
  return detectArchiveType(filename) !== null;
}

export default { extractArchive, detectArchiveType, isArchive };
