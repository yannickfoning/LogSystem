/**
 * Archive decompression utility
 * Supports: ZIP, GZIP, TAR, TAR+GZIP, RAR
 */

import decompress from 'decompress';
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
  }
  
  return null;
}

/**
 * Decompress archive (recursively) and extract log files.
 *
 * Phase 3+: If an archive contains another archive, we extract recursively until no archives remain.
 *
 * Returns array of:
 *  { filename, content, file_created_at, file_modified_at }
 */
export async function extractArchive(buffer, filename, maxExtractSize = 1073741824) { // 1GB
  const archiveType = detectArchiveType(filename, buffer);

  if (!archiveType) {
    throw new Error(`Unknown archive type for ${filename}`);
  }

  logger.info({ event: 'archive_detected', archiveType, filename }, '[ARCHIVE]');

  try {
    // 1) Extract one layer (archive -> candidate files)
    const extracted = await extractOneLayer(buffer, filename, maxExtractSize);

    // 2) Recursively extract nested archives (rar/zip/gz/tar/...) found among extracted files
    const results = [];
    for (const f of extracted) {
      const nestedType = detectArchiveType(f.filename, f.content);
      if (nestedType) {
        const nestedExtracted = await extractArchive(f.content, f.filename, maxExtractSize);
        results.push(...nestedExtracted);
      } else {
        results.push(f);
      }
    }

    return results;
  } catch (e) {
    logger.error({ event: 'archive_extraction_failed', archiveType, filename, error: e.message }, '[ARCHIVE]');
    throw new Error(`Failed to extract ${archiveType} archive: ${e.message}`);
  }
}

async function extractOneLayer(buffer, filename, maxExtractSize) {
  const archiveType = detectArchiveType(filename, buffer);

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

    default:
      throw new Error(`Unsupported archive type: ${archiveType}`);
  }
}

/**
 * Extract ZIP archive
 */
async function extractZip(buffer, maxSize) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'logsystem-zip-'));
  const extractDir = path.join(tempRoot, 'extracted');
  
  try {
    await fs.mkdir(extractDir, { recursive: true });

    // Extract to disk so we can fs.stat for Phase 4 timestamps.
    // Note: unzipper will create directories as needed.
    await new Promise((resolve, reject) => {
      const unzipStream = unzipper.Extract({ path: extractDir });
      unzipStream.on('close', resolve);
      unzipStream.on('error', reject);

      // unzipper can take a buffer via stream input
      const { Readable } = await import('stream');
      Readable.from(buffer).pipe(unzipStream);
    });

    const files = [];
    let totalSize = 0;

    const extractedFiles = await listFilesRecursive(extractDir);
    for (const filePath of extractedFiles) {
      const rel = path.relative(extractDir, filePath).replace(/\\/g, '/');
      const ext = path.extname(filePath).slice(1).toLowerCase();

      // Skip hidden files and common binary files
      if (rel.startsWith('.') || rel.match(/\.(exe|dll|so|dylib|bin|jpg|png|gif|zip)$/i)) {
        continue;
      }
      // Always skip known binary extensions AND archive-like extensions to avoid double-extraction.
      if (ext && (SKIPPED_EXTENSIONS.has(ext) || ['zip','rar','7z','tar','gz','gzip','tgz','brotli','br','zst','zstandard'].includes(ext))) {
        continue;
      }

      const stat = await fs.stat(filePath);
      totalSize += stat.size;
      if (totalSize > maxSize) {
        throw new Error(`Archive too large (> ${maxSize} bytes)`);
      }

      const fileContent = await fs.readFile(filePath);
      const fileCreatedAt = stat.birthtime && !Number.isNaN(stat.birthtime.getTime())
        ? stat.birthtime
        : null;
      const fileModifiedAt = stat.mtime && !Number.isNaN(stat.mtime.getTime())
        ? stat.mtime
        : null;

      files.push({
        filename: rel,
        content: fileContent,
        file_created_at: fileCreatedAt,
        file_modified_at: fileModifiedAt
      });
    }

    return files;
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

/**
 * Extract GZIP archive
 */
async function extractGzip(buffer, maxSize) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'logsystem-gz-'));
  try {
    const decompressed = await gunzip(buffer);
    if (decompressed.length > maxSize) {
      throw new Error(`Decompressed size too large (> ${maxSize} bytes)`);
    }

    const outputFile = path.join(tempRoot, 'decompressed.log');
    await fs.writeFile(outputFile, decompressed);
    const stat = await fs.stat(outputFile);

    const fileCreatedAt = stat.birthtime && !Number.isNaN(stat.birthtime.getTime())
      ? stat.birthtime
      : null;
    const fileModifiedAt = stat.mtime && !Number.isNaN(stat.mtime.getTime())
      ? stat.mtime
      : null;

    return [{
      filename: 'decompressed.log',
      content: decompressed,
      file_created_at: fileCreatedAt,
      file_modified_at: fileModifiedAt
    }];
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
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
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'logsystem-tar-'));
  try {
    const extractDir = path.join(tempRoot, 'extracted');
    await fs.mkdir(extractDir, { recursive: true });

    // We extract to disk so we can stat each file for Phase 4 timestamps.
    await decompress(Buffer.from(buffer), extractDir);

    // We list files from disk to be consistent.
    const results = [];
    let totalSize = 0;

    const extractedFiles = await listFilesRecursive(extractDir);
    for (const filePath of extractedFiles) {
      const ext = path.extname(filePath).slice(1).toLowerCase();
      const rel = path.relative(extractDir, filePath).replace(/\\/g, '/');

      if (rel.startsWith('.') || rel.match(/\.(exe|dll|so|dylib|bin|jpg|png|gif|zip)$/i)) {
        continue;
      }
      if (ext && SKIPPED_EXTENSIONS.has(ext)) {
        continue;
      }

      const stat = await fs.stat(filePath);
      totalSize += stat.size;
      if (totalSize > maxSize) {
        throw new Error(`Archive too large (> ${maxSize} bytes)`);
      }

      const fileContent = await fs.readFile(filePath);
      const fileCreatedAt = stat.birthtime && !Number.isNaN(stat.birthtime.getTime())
        ? stat.birthtime
        : null;
      const fileModifiedAt = stat.mtime && !Number.isNaN(stat.mtime.getTime())
        ? stat.mtime
        : null;

      results.push({
        filename: rel,
        content: fileContent,
        file_created_at: fileCreatedAt,
        file_modified_at: fileModifiedAt
      });
    }

    return results;
  } catch (e) {
    throw new Error(`TAR extraction failed: ${e.message}`);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

/**
 * Extract RAR archive using unrar or 7z.
 * Requires one of these tools to be installed on the system.
 */
async function extractRar(buffer, filename, maxSize) {
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

      // Node: birthtime is not always available/meaningful depending on FS/OS.
      const fileCreatedAt = stat.birthtime && !Number.isNaN(stat.birthtime.getTime())
        ? stat.birthtime
        : null;
      const fileModifiedAt = stat.mtime && !Number.isNaN(stat.mtime.getTime())
        ? stat.mtime
        : null;

      files.push({
        filename: path.relative(extractDir, filePath).replace(/\\/g, '/'),
        content: fileContent,
        file_created_at: fileCreatedAt,
        file_modified_at: fileModifiedAt
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
 * Check if buffer is a compressed archive
 */
export function isArchive(filename) {
  return detectArchiveType(filename) !== null;
}

export default { extractArchive, detectArchiveType, isArchive };
