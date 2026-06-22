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
const { createExtractorFromData } = require('node-unrar-js');

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

// ── RAR — pure JS WASM (node-unrar-js) ───────────────────────────────────────
async function extractRar(buffer, filename, maxSize) {
  logger.info({ event: 'rar_extract_start', filename }, '[ARCHIVE]');

  // Strategy 1: node-unrar-js (WASM — works on Vercel, no system binary needed)
  try {
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
    logger.warn({ event: 'rar_wasm_failed', error: e.message }, '[ARCHIVE] WASM failed, trying 7za bundled binary');
  }

  // Strategy 2: bundled 7za binary (7zip-bin — also works on Vercel)
  return extractWith7z(buffer, filename || 'archive.rar', '.rar', maxSize);
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
