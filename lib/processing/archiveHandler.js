/**
 * Archive decompression utility — LogSystem v6.1
 * Supports: ZIP, GZIP, TAR, TAR.GZ, RAR, 7Z
 *
 * Vercel-compatible: WASM (node-unrar-js) for RAR + bundled 7za for other formats.
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import zlib from 'zlib';
import { promisify } from 'util';
import unzipper from 'unzipper';
import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import logger from '../../config/logger.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_VERCEL = !!(process.env.VERCEL || process.env.VERCEL_ENV);
const IS_RENDER = !!(process.env.RENDER || process.env.RENDER_SERVICE_NAME);
const IS_CLOUD = IS_VERCEL || IS_RENDER;
const EXTRACT_TIMEOUT_MS = IS_CLOUD ? 120000 : 30000;

let _unrarCreateExtractor = null;
async function getUnrarExtractor() {
  if (_unrarCreateExtractor !== null && _unrarCreateExtractor !== undefined) {
    return _unrarCreateExtractor || null;
  }

  try {
    // Use CommonJS version for stability - ESM version has missing dependencies
    const unrar = require('node-unrar-js');
    const { createExtractorFromData: cef } = unrar;
    
    const wasmPaths = [
      path.join(__dirname, '..', 'assets', 'unrar.wasm'),
      path.join(path.dirname(require.resolve('node-unrar-js')), 'dist', 'js', 'unrar.wasm'),
      path.join(path.dirname(require.resolve('node-unrar-js')), 'js', 'unrar.wasm'),
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
      logger.info({ event: 'unrar_wasm_loaded', path: loadedPath, isVercel: IS_VERCEL, isRender: IS_RENDER }, '[ARCHIVE]');
      _unrarCreateExtractor = (opts) => cef({ ...opts, wasmBinary });
    } else {
      logger.warn({ event: 'unrar_wasm_not_found', attemptedPaths: wasmPaths }, '[ARCHIVE]');
      _unrarCreateExtractor = null;
    }
    return _unrarCreateExtractor;
  } catch (e) {
    logger.warn({ event: 'unrar_load_failed', error: e.message, stack: e.stack }, '[ARCHIVE]');
    _unrarCreateExtractor = null;
    return null;
  }
}

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

// Decompression limits to prevent archive bombs
const MAX_EXTRACTED_FILES = parseInt(process.env.MAX_EXTRACTED_FILES || '1000', 10);
const MAX_TOTAL_EXTRACTED_SIZE = parseInt(process.env.MAX_TOTAL_EXTRACTED_SIZE || '500') * 1024 * 1024; // Default 500MB
const MAX_SINGLE_FILE_SIZE = parseInt(process.env.MAX_SINGLE_FILE_SIZE || '100') * 1024 * 1024; // Default 100MB
const MAX_ARCHIVE_DEPTH = parseInt(process.env.MAX_ARCHIVE_DEPTH || '3', 10); // Prevent nested archives

export const LOG_FILE_PATTERN = /\.(log|txt|json|jsonl|csv|xml)$/i;

// Extended pattern to include files without standard extensions
export const TEXT_FILE_PATTERN = /\.(log|txt|json|jsonl|csv|xml|application_log|log\.\d{4}-\d{2}-\d{2})$/i;

export class ArchiveError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = 'ArchiveError';
    this.code = code;
    this.status = status;
  }
}

export function filterLogFiles(files) {
  return (files || []).filter((f) => {
    const filename = f.filename || '';
    // Accept files with proper extensions OR files containing "log" in the name
    // OR files without extensions (like application_log.2026-05-18)
    const hasExtension = LOG_FILE_PATTERN.test(filename);
    const hasLogInName = filename.toLowerCase().includes('log');
    const hasDatePattern = /\d{4}-\d{2}-\d{2}$/.test(filename);
    const noExtension = !filename.includes('.');
    
    return hasExtension || hasLogInName || hasDatePattern || noExtension;
  });
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
  if (err?.code === 'TOO_MANY_FILES') {
    return new ArchiveError('TOO_MANY_FILES', 413, `Trop de fichiers dans l'archive (max ${MAX_EXTRACTED_FILES}).`);
  }
  if (err?.code === 'TOTAL_SIZE_EXCEEDED') {
    return new ArchiveError('TOTAL_SIZE_EXCEEDED', 413, `Taille totale décompressée trop grande (max ${MAX_TOTAL_EXTRACTED_SIZE / 1024 / 1024}MB).`);
  }
  if (err?.code === 'SINGLE_FILE_TOO_LARGE') {
    return new ArchiveError('SINGLE_FILE_TOO_LARGE', 413, `Fichier individuel trop grand (max ${MAX_SINGLE_FILE_SIZE / 1024 / 1024}MB).`);
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

export async function extractArchive(buffer, filename, maxExtractSize = Infinity) {
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

async function extractZip(buffer, maxSize) {
  return new Promise((resolve, reject) => {
    const files = [];
    let totalSize = 0;
    let fileCount = 0;
    let pending = 0;
    let ended = false;

    const stream = unzipper.Parse();

    stream.on('entry', (entry) => {
      const filename = entry.path;
      const type = entry.type;

      if (type !== 'File') { entry.autodrain(); return; }

      // Check file count limit
      fileCount++;
      if (fileCount > MAX_EXTRACTED_FILES) {
        const error = new ArchiveError('TOO_MANY_FILES', 413, 
          `Trop de fichiers dans l'archive (max ${MAX_EXTRACTED_FILES})`);
        entry.autodrain();
        stream.destroy();
        return reject(error);
      }

      const norm = path.normalize(filename).replace(/\\/g, '/');
      if (norm.includes('../') || path.isAbsolute(norm) ||
          filename.startsWith('.') ||
          /\.(exe|dll|so|dylib|bin|jpg|png|gif|zip)$/i.test(filename)) {
        entry.autodrain(); return;
      }

      pending++;
      const chunks = [];
      let fileSize = 0;
      
      entry.on('data', chunk => {
        // Check total size limit
        totalSize += chunk.length;
        fileSize += chunk.length;
        
        if (totalSize > MAX_TOTAL_EXTRACTED_SIZE) {
          const error = new ArchiveError('TOTAL_SIZE_EXCEEDED', 413,
            `Taille totale décompressée trop grande (max ${MAX_TOTAL_EXTRACTED_SIZE / 1024 / 1024}MB)`);
          entry.autodrain();
          stream.destroy();
          return reject(error);
        }
        
        // Check single file size limit
        if (fileSize > MAX_SINGLE_FILE_SIZE) {
          const error = new ArchiveError('SINGLE_FILE_TOO_LARGE', 413,
            `Fichier individuel trop grand (max ${MAX_SINGLE_FILE_SIZE / 1024 / 1024}MB)`);
          entry.autodrain();
          stream.destroy();
          return reject(error);
        }
        
        chunks.push(chunk);
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

async function extractGzip(buffer, filename, maxSize) {
  const decompressed = await gunzip(buffer);
  
  // Check size limits
  if (decompressed.length > MAX_SINGLE_FILE_SIZE) {
    throw new ArchiveError('SINGLE_FILE_TOO_LARGE', 413,
      `Fichier décompressé trop grand (max ${MAX_SINGLE_FILE_SIZE / 1024 / 1024}MB)`);
  }
  
  const innerName = (filename || 'file.log').replace(/\.(gz|gzip)$/i, '') || 'decompressed.log';
  return [{ filename: innerName, content: decompressed }];
}

async function extractTarGz(buffer, maxSize) {
  const decompressed = await gunzip(buffer);
  return extractWith7z(decompressed, 'archive.tar', '.tar', maxSize);
}

async function extractTarWith7z(buffer, filename, maxSize) {
  return extractWith7z(buffer, filename, '.tar', maxSize);
}

async function extractRar(buffer, filename, maxSize) {
  logger.info({ event: 'rar_extract_start', filename, isVercel: IS_VERCEL, isRender: IS_RENDER }, '[ARCHIVE]');

  const createExtractorFromData = await getUnrarExtractor();
  if (!createExtractorFromData) {
    throw new ArchiveError('RAR_UNSUPPORTED', 400,
      'Extraction RAR non disponible sur cette plateforme. Utilisez .zip ou .7z à la place.');
  }

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

    // Check file count limit
    if (filesToExtract.length > MAX_EXTRACTED_FILES) {
      throw new ArchiveError('TOO_MANY_FILES', 413,
        `Trop de fichiers dans l'archive (max ${MAX_EXTRACTED_FILES})`);
    }

    const extracted = extractor.extract({ files: filesToExtract });
    const files = [];
    let totalSize = 0;

    for (const file of extracted.files) {
      if (file.fileHeader.flags.directory) continue;
      const content = file.extraction;
      if (!content) continue;

      const fileSize = content.byteLength;
      
      // Check single file size limit
      if (fileSize > MAX_SINGLE_FILE_SIZE) {
        throw new ArchiveError('SINGLE_FILE_TOO_LARGE', 413,
          `Fichier individuel trop grand (max ${MAX_SINGLE_FILE_SIZE / 1024 / 1024}MB)`);
      }
      
      totalSize += fileSize;

      // Check total size limit
      if (totalSize > MAX_TOTAL_EXTRACTED_SIZE) {
        throw new ArchiveError('TOTAL_SIZE_EXCEEDED', 413,
          `Taille totale décompressée trop grande (max ${MAX_TOTAL_EXTRACTED_SIZE / 1024 / 1024}MB)`);
      }

      const name = file.fileHeader.name;
      const ext = path.extname(name).slice(1).toLowerCase();
      if (!SKIPPED_EXTENSIONS.has(ext)) {
        files.push({ filename: name, content: Buffer.from(content) });
      }
    }

    if (files.length > 0) {
      logger.info({ event: 'rar_extracted_wasm', filename, fileCount: files.length }, '[ARCHIVE]');
      return files;
    } else {
      throw new ArchiveError('NO_LOG_FILES', 400, 'Aucun fichier log trouvé dans l\'archive RAR.');
    }
  } catch (e) {
    if (e instanceof ArchiveError) throw e;
    if (/password|encrypted/i.test(e.message)) {
      throw new ArchiveError('RAR_ENCRYPTED', 403, 'Archive RAR protégée par mot de passe.');
    }
    logger.error({ event: 'rar_extraction_failed', filename, error: e.message }, '[ARCHIVE]');
    throw new ArchiveError('RAR_EXTRACTION_FAILED', 400,
      'Extraction RAR échouée. Vérifiez que le fichier n\'est pas corrompu ou protégé par mot de passe.');
  }
}

async function ensure7zaExecutable() {
  if (!path7za) return;
  try {
    await fs.chmod(path7za, 0o755);
  } catch (_) {}
}

async function extractWith7z(buffer, filename, ext, maxSize) {
  if (!path7za) {
    throw new ArchiveError(
      'ARCHIVE_BINARY_MISSING',
      500,
      "Binaire 7z indisponible. Installez la dependance 7zip-bin pour ce format."
    );
  }

  await ensure7zaExecutable();

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'logsystem-'));
  const extractDir = path.join(tempRoot, 'out');
  const safeName = (path.basename(filename || `archive${ext}`)
    .replace(/[^\w.\- ]+/g, '_') || `archive${ext}`);
  const tempFile = path.join(tempRoot, safeName);

  try {
    await fs.mkdir(extractDir, { recursive: true });
    await fs.writeFile(tempFile, buffer);

    await execFileAsync(path7za, ['x', '-y', `-o${extractDir}`, tempFile], {
      windowsHide: true,
      maxBuffer: 100 * 1024 * 1024,
      timeout: EXTRACT_TIMEOUT_MS
    });

    const files = [];
    let totalSize = 0;
    const found = await listFilesRecursive(extractDir);

    // Check file count limit
    if (found.length > MAX_EXTRACTED_FILES) {
      throw new ArchiveError('TOO_MANY_FILES', 413,
        `Trop de fichiers dans l'archive (max ${MAX_EXTRACTED_FILES})`);
    }

    for (const filePath of found) {
      const fileExt = path.extname(filePath).slice(1).toLowerCase();
      if (SKIPPED_EXTENSIONS.has(fileExt)) continue;

      const stat = await fs.stat(filePath);
      
      // Check single file size limit
      if (stat.size > MAX_SINGLE_FILE_SIZE) {
        throw new ArchiveError('SINGLE_FILE_TOO_LARGE', 413,
          `Fichier individuel trop grand (max ${MAX_SINGLE_FILE_SIZE / 1024 / 1024}MB)`);
      }
      
      totalSize += stat.size;

      // Check total size limit
      if (totalSize > MAX_TOTAL_EXTRACTED_SIZE) {
        throw new ArchiveError('TOTAL_SIZE_EXCEEDED', 413,
          `Taille totale décompressée trop grande (max ${MAX_TOTAL_EXTRACTED_SIZE / 1024 / 1024}MB)`);
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
