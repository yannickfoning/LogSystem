/**
 * Archive decompression utility — LogSystem v6.1
 * Supports: ZIP, GZIP, TAR, TAR.GZ, RAR, 7Z
 *
 * Vercel-compatible: uses bundled binaries (7zip-bin) and WASM (node-unrar-js)
 * No system binaries required (unrar / 7z system install NOT needed).
 */

import { createRequire } from 'module';
import zlib from 'zlib';
import { promisify } from 'util';
import unzipper from 'unzipper';
import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import logger from '../../config/logger.js';

// CJS interop — node-unrar-js exports CJS only (ESM path is broken)
const require = createRequire(import.meta.url);

// VERCEL COMPATIBILITY: Disable node-unrar-js (WASM bundling unreliable on Vercel)
// Use 7zip-bin (bundled binary) instead, which is more reliable
let _unrarCreateExtractor = null;
async function getUnrarExtractor() {
  // Return null to disable WASM extraction on Vercel runtime
  // RAR files will fallback to 7z extraction via bundled 7za binary
  if (process.env.VERCEL) {
    logger.info({ event: 'unrar_disabled_vercel', reason: 'WASM bundling unreliable' }, '[ARCHIVE]');
    return null;
  }
  
  if (_unrarCreateExtractor) return _unrarCreateExtractor;
  try {
    const { createExtractorFromData: cef } = require('node-unrar-js');
    // Try loading the WASM binary from known paths (dist or esm)
    const wasmPaths = [
      path.join(path.dirname(require.resolve('node-unrar-js')), 'dist', 'js', 'unrar.wasm'),
      path.join(path.dirname(require.resolve('node-unrar-js')), 'js', 'unrar.wasm'),
      path.join(path.dirname(require.resolve('node-unrar-js')), '..', 'esm', 'js', 'unrar.wasm'),
      path.join(process.cwd(), 'node_modules', 'node-unrar-js', 'dist', 'js', 'unrar.wasm'),
      path.join(process.cwd(), 'node_modules', 'node-unrar-js', 'js', 'unrar.wasm'),
    ];
    let wasmBinary = null;
    let loadedPath = null;
    for (const p of wasmPaths) {
      try { 
        wasmBinary = await fs.readFile(p); 
        loadedPath = p;
        break; 
      } catch (_) {}
    }
    
    if (wasmBinary) {
      logger.info({ event: 'unrar_wasm_loaded', path: loadedPath }, '[ARCHIVE]');
    } else {
      logger.warn({ event: 'unrar_wasm_not_found', attemptedPaths: wasmPaths }, '[ARCHIVE] WASM binary not found, will use 7z fallback');
    }
    
    // Wrap createExtractorFromData to always inject the wasmBinary
    _unrarCreateExtractor = wasmBinary
      ? (opts) => cef({ ...opts, wasmBinary })
      : null;
    return _unrarCreateExtractor;
  } catch (e) {
    logger.warn({ event: 'unrar_load_failed', error: e.message }, '[ARCHIVE]');
    return null;
  }
}

// 7zip-bin bundles platform-specific 7za binary. RAR first uses node-unrar-js;
// 7z/tar fall back to this binary when it is available.
let path7za = null;
try {
  ({ path7za } = require('7zip-bin'));
} catch (err) {
  logger.warn({ event: '7zip_bin_unavailable', error: err.message }, '[ARCHIVE]');
}

const gunzip = promisify(zlib.gunzip);
const execFileAsync = promisify(execFile);

const SKIPPED_EXTENSIONS = new Set([
  'exe', 'dll', 'so', 'dylib', 'bin', 'jpg', 'jpeg',
  'png', 'gif', 'zip', 'rar', '7z', 'tar', 'gz'
]);

export const LOG_FILE_PATTERN = /\.(log|txt|json|jsonl|csv|xml)$/i;

export class ArchiveError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = 'ArchiveError';
    this.code = code;
    this.status = status;
  }
}

export function filterLogFiles(files) {
  return (files || []).filter((f) => LOG_FILE_PATTERN.test(f.filename || ''));
}

export function mapArchiveError(err) {
  const msg = String(err?.message || '');
  if (err instanceof ArchiveError) return err;
  if (err?.code === 'RAR_ENCRYPTED' || /password|encrypted|mot de passe/i.test(msg)) {
    return new ArchiveError('RAR_ENCRYPTED', 403, 'Archive protégée par mot de passe — non supportée.');
  }
  if (/corrupt|invalid|Unexpected end|failed to open/i.test(msg)) {
    return new ArchiveError('RAR_CORRUPT', 400, 'Archive invalide ou corrompue. Téléchargez à nouveau.');
  }
  if (err?.code === 'NO_LOG_FILES') return err;
  if (/too large|exceeds maximum/i.test(msg)) {
    return new ArchiveError('FILE_TOO_LARGE', 413, 'Fichier trop gros (max 1 GB décompressé).');
  }
  return new ArchiveError('ARCHIVE_ERROR', 400, msg || "Erreur lors de l'extraction.");
}

export function detectArchiveType(filename, buffer) {
  const name = (filename || '').toLowerCase();
  if (name.endsWith('.tar.gz') || name.endsWith('.tgz')) return 'targz';
  if (name.endsWith('.zip'))  return 'zip';
  if (name.endsWith('.gz') || name.endsWith('.gzip')) return 'gzip';
  if (name.endsWith('.rar'))  return 'rar';
  if (name.endsWith('.7z'))   return 'sevenzip';
  if (name.endsWith('.tar'))  return 'tar';
  if (name.endsWith('.br') || name.endsWith('.brotli')) return 'brotli';
  if (name.endsWith('.zst') || name.endsWith('.zstandard')) return 'zstandard';

  if (buffer && buffer.length >= 2) {
    const b = buffer;
    if (b[0] === 0x50 && b[1] === 0x4B) return 'zip';
    if (b[0] === 0x1F && b[1] === 0x8B) return 'gzip';
    if (b[0] === 0x52 && b[1] === 0x61 && b[2] === 0x72 && b[3] === 0x21) return 'rar';
    if (b[0] === 0x37 && b[1] === 0x7A && b[2] === 0xBC && b[3] === 0xAF) return 'sevenzip';
    if (b[0] === 0x28 && b[1] === 0xB5 && b[2] === 0x2F && b[3] === 0xFD) return 'zstandard';
  }
  return null;
}

export function isArchive(filename) {
  return detectArchiveType(filename) !== null;
}

export async function extractArchive(buffer, filename, maxExtractSize = 1073741824) {
  const archiveType = detectArchiveType(filename, buffer);
  if (!archiveType) throw new ArchiveError('UNKNOWN_FORMAT', 400, `Format d'archive inconnu: ${filename}`);

  logger.info({ event: 'archive_extract_start', archiveType, filename }, '[ARCHIVE]');

  try {
    switch (archiveType) {
      case 'zip':        return await extractZip(buffer, maxExtractSize);
      case 'gzip':       return await extractGzip(buffer, filename, maxExtractSize);
      case 'targz':      return await extractTarGz(buffer, maxExtractSize);
      case 'tar':        return await extractTarWith7z(buffer, filename, maxExtractSize);
      case 'rar':        return await extractRar(buffer, filename, maxExtractSize);
      case 'sevenzip':   return await extractWith7z(buffer, filename, '.7z', maxExtractSize);
      case 'brotli':
      case 'zstandard':
        throw new ArchiveError('UNSUPPORTED_FORMAT', 400,
          `Format ${archiveType} non supporté. Utilisez .zip, .gz, .tar.gz, .rar ou .7z.`);
      default:
        throw new ArchiveError('UNSUPPORTED_FORMAT', 400, `Format non supporté: ${archiveType}`);
    }
  } catch (e) {
    logger.error({ event: 'archive_extract_failed', archiveType, filename, error: e.message }, '[ARCHIVE]');
    if (e instanceof ArchiveError) throw e;
    throw mapArchiveError(e);
  }
}

// ── ZIP ───────────────────────────────────────────────────────────────────────
async function extractZip(buffer, maxSize) {
  return new Promise((resolve, reject) => {
    const files = [];
    let totalSize = 0;
    let pending = 0;
    let ended = false;

    const stream = unzipper.Parse();

    stream.on('entry', (entry) => {
      const filename = entry.path;
      const type = entry.type;

      if (type !== 'File') { entry.autodrain(); return; }

      const norm = path.normalize(filename).replace(/\\/g, '/');
      if (norm.includes('../') || path.isAbsolute(norm) ||
          filename.startsWith('.') ||
          /\.(exe|dll|so|dylib|bin|jpg|png|gif|zip)$/i.test(filename)) {
        entry.autodrain(); return;
      }

      pending++;
      const chunks = [];
      entry.on('data', chunk => {
        chunks.push(chunk);
        totalSize += chunk.length;
        if (totalSize > maxSize) {
          entry.destroy();
          stream.destroy();
          reject(new ArchiveError('FILE_TOO_LARGE', 413, 'Archive trop grande après décompression.'));
        }
      });
      entry.on('end', () => {
        files.push({ filename, content: Buffer.concat(chunks) });
        pending--;
        if (pending === 0 && ended) resolve(files);
      });
      entry.on('error', reject);
    });

    stream.on('finish', () => { ended = true; if (pending === 0) resolve(files); });
    stream.on('error', reject);
    stream.end(buffer);
  });
}

// ── GZIP ──────────────────────────────────────────────────────────────────────
async function extractGzip(buffer, filename, maxSize) {
  const decompressed = await gunzip(buffer);
  if (decompressed.length > maxSize) {
    throw new ArchiveError('FILE_TOO_LARGE', 413, 'Fichier trop grand après décompression.');
  }
  // Strip .gz from filename for the inner file
  const innerName = (filename || 'file.log').replace(/\.(gz|gzip)$/i, '') || 'decompressed.log';
  return [{ filename: innerName, content: decompressed }];
}

// ── TAR.GZ ────────────────────────────────────────────────────────────────────
async function extractTarGz(buffer, maxSize) {
  // Decompress gzip first, then extract as tar via 7za
  const decompressed = await gunzip(buffer);
  return extractWith7z(decompressed, 'archive.tar', '.tar', maxSize);
}

// ── TAR via 7z ───────────────────────────────────────────────────────────────
async function extractTarWith7z(buffer, filename, maxSize) {
  return extractWith7z(buffer, filename, '.tar', maxSize);
}

// ── RAR — pure JS WASM (node-unrar-js) with 7z fallback ─────────────────────
async function extractRar(buffer, filename, maxSize) {
  logger.info({ event: 'rar_extract_start', filename, isVercel: !!process.env.VERCEL }, '[ARCHIVE]');

  // Strategy 1: node-unrar-js (WASM — disabled on Vercel)
  const createExtractorFromData = await getUnrarExtractor();
  try {
    if (!createExtractorFromData) {
      logger.info({ event: 'rar_wasm_unavailable', reason: process.env.VERCEL ? 'Vercel environment' : 'WASM not found' }, '[ARCHIVE]');
      throw new Error('WASM extractor unavailable, using 7z fallback');
    }
    const extractor = await createExtractorFromData({ data: buffer });

    const list = extractor.getFileList();
    const fileHeaders = [...list.fileHeaders];

    for (const h of fileHeaders) {
      if (h.flags?.encrypted) {
        throw new ArchiveError('RAR_ENCRYPTED', 403,
          'Archive RAR protégée par mot de passe — non supportée.');
      }
    }

    const filesToExtract = fileHeaders
      .filter(h => !h.flags.directory)
      .map(h => h.name);

    const extracted = extractor.extract({ files: filesToExtract });

    const files = [];
    let totalSize = 0;

    for (const file of extracted.files) {
      if (file.fileHeader.flags.directory) continue;
      const content = file.extraction;
      if (!content) continue;

      totalSize += content.byteLength;
      if (totalSize > maxSize) {
        throw new ArchiveError('FILE_TOO_LARGE', 413, 'Archive trop grande après décompression.');
      }

      const name = file.fileHeader.name;
      const ext = path.extname(name).slice(1).toLowerCase();
      if (!SKIPPED_EXTENSIONS.has(ext)) {
        files.push({ filename: name, content: Buffer.from(content) });
      }
    }

    logger.info({ event: 'rar_extracted_wasm', filename, fileCount: files.length }, '[ARCHIVE]');
    return files;

  } catch (e) {
    if (e instanceof ArchiveError) throw e;
    if (/password|encrypted/i.test(e.message)) {
      throw new ArchiveError('RAR_ENCRYPTED', 403, 'Archive RAR protégée par mot de passe.');
    }
    
    // On Vercel or when WASM is unavailable, use 7z
    if (/ENOENT|no such file|unrar\.wasm|WASM|unavailable/i.test(e.message)) {
      logger.info({ event: 'rar_fallback_to_7z', filename, reason: e.message }, '[ARCHIVE] Using 7z binary for RAR extraction');
    } else {
      logger.warn({ event: 'rar_wasm_failed', error: e.message }, '[ARCHIVE] WASM failed, trying 7z');
    }
  }

  // Strategy 2: bundled 7za binary (7zip-bin — reliable on Vercel)
  try {
    logger.info({ event: 'rar_extract_7z', filename }, '[ARCHIVE]');
    return await extractWith7z(buffer, filename || 'archive.rar', '.rar', maxSize);
  } catch (e) {
    logger.error({ event: 'rar_extraction_failed', filename, error: e.message }, '[ARCHIVE]');
    if (e instanceof ArchiveError) throw e;
    throw new ArchiveError('RAR_EXTRACTION_FAILED', 400, 
      `Extraction RAR échouée. Sur Vercel, utilisez ZIP ou 7z pour les archives compressées.`);
  }
}

// ── 7z / generic via bundled 7za binary ──────────────────────────────────────
async function extractWith7z(buffer, filename, ext, maxSize) {
  if (!path7za) {
    throw new ArchiveError(
      'ARCHIVE_BINARY_MISSING',
      500,
      "Binaire 7z indisponible. Installez la dependance 7zip-bin pour ce format."
    );
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'logsystem-'));
  const extractDir = path.join(tempRoot, 'out');
  const safeName = (path.basename(filename || `archive${ext}`)
    .replace(/[^\w.\- ]+/g, '_') || `archive${ext}`);
  const tempFile = path.join(tempRoot, safeName);

  try {
    await fs.mkdir(extractDir, { recursive: true });
    await fs.writeFile(tempFile, buffer);

    // path7za = bundled binary from 7zip-bin (linux/x64/7za on Vercel)
    await execFileAsync(path7za, ['x', '-y', `-o${extractDir}`, tempFile], {
      windowsHide: true,
      maxBuffer: 100 * 1024 * 1024, // 100MB stdout buffer
      timeout: 30000 // 30s max
    });

    const files = [];
    let totalSize = 0;
    const found = await listFilesRecursive(extractDir);

    for (const filePath of found) {
      const fileExt = path.extname(filePath).slice(1).toLowerCase();
      if (SKIPPED_EXTENSIONS.has(fileExt)) continue;

      const stat = await fs.stat(filePath);
      totalSize += stat.size;
      if (totalSize > maxSize) {
        throw new ArchiveError('FILE_TOO_LARGE', 413, 'Archive trop grande après décompression.');
      }

      const content = await fs.readFile(filePath);
      files.push({
        filename: path.relative(extractDir, filePath).replace(/\\/g, '/'),
        content
      });
    }

    logger.info({ event: '7z_extracted', filename, fileCount: files.length, binary: path7za }, '[ARCHIVE]');
    return files;

  } catch (e) {
    if (e instanceof ArchiveError) throw e;
    throw new ArchiveError('ARCHIVE_ERROR', 400, `Extraction échouée: ${e.message}`);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

// ── Helper ────────────────────────────────────────────────────────────────────
async function listFilesRecursive(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listFilesRecursive(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

export default { extractArchive, detectArchiveType, filterLogFiles, isArchive, mapArchiveError };
