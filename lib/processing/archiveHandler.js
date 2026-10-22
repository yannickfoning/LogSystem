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
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
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

let _unrarCreateExtractor = null;
let _unrarCreateFileExtractor = null;
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

async function getUnrarFileExtractor() {
  if (_unrarCreateFileExtractor !== null && _unrarCreateFileExtractor !== undefined) {
    return _unrarCreateFileExtractor || null;
  }

  try {
    const unrar = require('node-unrar-js');
    const createExtractorFromFile = unrar.createExtractorFromFile;
    if (typeof createExtractorFromFile !== 'function') {
      _unrarCreateFileExtractor = null;
      return null;
    }

    const wasmPaths = [
      path.join(__dirname, '..', 'assets', 'unrar.wasm'),
      path.join(path.dirname(require.resolve('node-unrar-js')), 'js', 'unrar.wasm'),
      path.join(process.cwd(), 'node_modules', 'node-unrar-js', 'dist', 'js', 'unrar.wasm'),
    ];
    let wasmBinary = null;
    let loadedPath = null;
    for (const wasmPath of wasmPaths) {
      try {
        wasmBinary = await fs.readFile(wasmPath);
        loadedPath = wasmPath;
        break;
      } catch (_) {}
    }

    if (!wasmBinary) {
      logger.warn({ event: 'unrar_wasm_not_found', attemptedPaths: wasmPaths }, '[ARCHIVE]');
      _unrarCreateFileExtractor = null;
      return null;
    }

    logger.info({ event: 'unrar_wasm_loaded', path: loadedPath, mode: 'file' }, '[ARCHIVE]');
    _unrarCreateFileExtractor = (opts) => createExtractorFromFile({ ...opts, wasmBinary });
    return _unrarCreateFileExtractor;
  } catch (e) {
    logger.warn({ event: 'unrar_file_load_failed', error: e.message, stack: e.stack }, '[ARCHIVE]');
    _unrarCreateFileExtractor = null;
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
  'png', 'gif', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'
]);

// Keep count/depth guards against pathological archives while leaving payload
// size uncapped at the application level. The host's memory/disk still apply.
const MAX_EXTRACTED_FILES = parseInt(process.env.MAX_EXTRACTED_FILES || '1000', 10);
const MAX_ARCHIVE_DEPTH = parseInt(process.env.MAX_ARCHIVE_DEPTH || '3', 10); // Prevent nested archives

export const LOG_FILE_PATTERN = /\.(log|txt|json|jsonl|csv|xml)(\.(gz|bz2|xz))?$/i;

// Extended pattern to include files without standard extensions
export const TEXT_FILE_PATTERN = /\.(log|txt|json|jsonl|csv|xml|application_log|log\.\d{4}-\d{2}-\d{2})(\.(gz|bz2|xz))?$/i;

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
    const lower = filename.toLowerCase();
    // Ignore les dossiers, fichiers cachés/système et binaires évidents ; accepte
    // le reste (ex: logs archivés avec rotation : "app.log.2026-05-18", "app.2026-05-18").
    if (!filename || lower.endsWith('/') || /(^|\/)(\.|__macosx)/.test(lower)) return false;
    if (/\.(png|jpe?g|gif|pdf|exe|dll|bin|so|class|jar|docx?|xlsx?|pptx?)$/.test(lower)) return false;
    return LOG_FILE_PATTERN.test(filename) || lower.includes('log') || /\.\d{4}-\d{2}-\d{2}$/.test(lower) || !/\.[a-z0-9]{1,5}$/.test(lower) || /\.\d+$/.test(lower);
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
    return new ArchiveError('FILE_TOO_LARGE', 413, 'Fichier trop volumineux pour être traité par un outil sous-jacent d\'extraction.');
  }
  if (err?.code === 'TOO_MANY_FILES') {
    return new ArchiveError('TOO_MANY_FILES', 413, `Trop de fichiers dans l'archive (max ${MAX_EXTRACTED_FILES}).`);
  }
  if (err?.code === 'TOTAL_SIZE_EXCEEDED') {
    return new ArchiveError('TOTAL_SIZE_EXCEEDED', 413, 'Archive refusée par une ancienne limite de taille. Réessayez après redémarrage du service.');
  }
  if (err?.code === 'SINGLE_FILE_TOO_LARGE') {
    return new ArchiveError('SINGLE_FILE_TOO_LARGE', 413, 'Fichier refusé par une ancienne limite de taille. Réessayez après redémarrage du service.');
  }
  return new ArchiveError('ARCHIVE_ERROR', 400, msg || "Erreur lors de l'extraction.");
}

export function detectArchiveType(filename, buffer) {
  const name = (filename || '').toLowerCase();
  if (name.endsWith('.tar.gz') || name.endsWith('.tgz')) return 'targz';
  if (name.endsWith('.zip'))  return 'zip';
  if (name.endsWith('.gz') || name.endsWith('.gzip')) return 'gzip';
  if (name.endsWith('.bz2')) return 'bzip2';
  if (name.endsWith('.xz')) return 'xz';
  if (name.endsWith('.rar'))  return 'rar';
  if (name.endsWith('.7z'))   return 'sevenzip';
  if (name.endsWith('.tar'))  return 'tar';
  if (name.endsWith('.br') || name.endsWith('.brotli')) return 'brotli';
  if (name.endsWith('.zst') || name.endsWith('.zstandard')) return 'zstandard';

  if (buffer && buffer.length >= 2) {
    const b = buffer;
    if (b[0] === 0x50 && b[1] === 0x4B) return 'zip';
    if (b[0] === 0x1F && b[1] === 0x8B) return 'gzip';
    if (b[0] === 0x42 && b[1] === 0x5A && b[2] === 0x68) return 'bzip2';
    if (b.length >= 6 && b[0] === 0xFD && b[1] === 0x37 && b[2] === 0x7A && b[3] === 0x58 && b[4] === 0x5A && b[5] === 0x00) return 'xz';
    if (b[0] === 0x52 && b[1] === 0x61 && b[2] === 0x72 && b[3] === 0x21) return 'rar';
    if (b[0] === 0x37 && b[1] === 0x7A && b[2] === 0xBC && b[3] === 0xAF) return 'sevenzip';
    if (b[0] === 0x28 && b[1] === 0xB5 && b[2] === 0x2F && b[3] === 0xFD) return 'zstandard';
  }
  return null;
}

export function isArchive(filename, buffer) {
  return detectArchiveType(filename, buffer) !== null;
}

export async function extractArchive(buffer, filename) {
  const archiveType = detectArchiveType(filename, buffer);
  if (!archiveType) throw new ArchiveError('UNKNOWN_FORMAT', 400, `Format d'archive inconnu: ${filename}`);

  logger.info({ event: 'archive_extract_start', archiveType, filename }, '[ARCHIVE]');

  try {
    switch (archiveType) {
      case 'zip':        return await extractZip(buffer);
      case 'gzip':       return await extractGzip(buffer, filename);
      case 'bzip2':      return await extractWith7z(buffer, filename, '.bz2');
      case 'xz':         return await extractWith7z(buffer, filename, '.xz');
      case 'targz':      return await extractTarGz(buffer);
      case 'tar':        return await extractTarWith7z(buffer, filename);
      case 'rar':        return await extractRar(buffer, filename);
      case 'sevenzip':   return await extractWith7z(buffer, filename, '.7z');
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

/** Expand nested archives and return every supported log-like file. */
export async function expandArchiveEntries(entries, depth = 0) {
  const logFiles = [];
  for (const entry of entries || []) {
    if (isArchive(entry.filename, entry.content)) {
      if (depth >= MAX_ARCHIVE_DEPTH) {
        throw new ArchiveError('ARCHIVE_DEPTH_EXCEEDED', 413,
          `Imbrication d'archives trop profonde (max ${MAX_ARCHIVE_DEPTH}).`);
      }
      const nestedEntries = await extractArchive(entry.content, entry.filename);
      logFiles.push(...await expandArchiveEntries(nestedEntries, depth + 1));
    } else if (filterLogFiles([entry]).length) {
      logFiles.push(entry);
    }
  }
  return logFiles;
}

export async function extractLogFiles(buffer, filename) {
  const entries = await extractArchive(buffer, filename);
  return expandArchiveEntries(entries);
}

/** Extract only log-like files from a RAR directly to disk to avoid keeping
 * both the compressed archive and its full uncompressed payload in memory. */
export async function extractRarToDirectory(archivePath, filename, targetPath) {
  const createExtractorFromFile = await getUnrarFileExtractor();
  if (!createExtractorFromFile) {
    throw new ArchiveError('RAR_UNSUPPORTED', 400,
      'Extraction RAR non disponible sur cette plateforme. Utilisez .zip ou .7z à la place.');
  }

  const safeTarget = path.resolve(targetPath);
  await fs.mkdir(safeTarget, { recursive: true });
  try {
    const extractor = await createExtractorFromFile({
      filepath: archivePath,
      targetPath: safeTarget,
      filenameTransform: name => safeArchiveEntryPath(name, safeTarget),
    });
    const headers = [...extractor.getFileList().fileHeaders];

    for (const header of headers) {
      if (header.flags?.encrypted) {
        throw new ArchiveError('RAR_ENCRYPTED', 403,
          'Archive RAR protégée par mot de passe — non supportée.');
      }
    }

    const selectedHeaders = headers.filter(header => {
      if (header.flags?.directory) return false;
      const entry = { filename: header.name };
      return filterLogFiles([entry]).length > 0 || isArchive(header.name);
    });
    const selectedNames = new Set(selectedHeaders.map(header => header.name));
    const extracted = extractor.extract({ files: fileHeader => selectedNames.has(fileHeader.name) });
    for (const file of extracted.files) void file.fileHeader.name;

    const files = [];
    for (const header of selectedHeaders) {
      const safeName = safeArchiveEntryPath(header.name, safeTarget);
      const filePath = path.resolve(safeTarget, ...safeName.split('/'));
      try {
        const stats = await fs.stat(filePath);
        if (stats.isFile()) files.push({ filename: safeName, path: filePath, size: stats.size });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }

    if (files.length === 0) {
      throw new ArchiveError('NO_LOG_FILES', 400, 'Aucun fichier log trouvé dans l\'archive RAR.');
    }

    logger.info({ event: 'rar_extracted_to_disk', filename, fileCount: files.length,
      totalBytes: files.reduce((total, file) => total + file.size, 0) }, '[ARCHIVE]');
    return files;
  } catch (error) {
    if (error instanceof ArchiveError) throw error;
    if (/password|encrypted|mot de passe/i.test(error.message)) {
      throw new ArchiveError('RAR_ENCRYPTED', 403, 'Archive RAR protégée par mot de passe.');
    }
    logger.error({ event: 'rar_extraction_failed', filename, error: error.message }, '[ARCHIVE]');
    throw mapArchiveError(error);
  }
}

/** Stream ZIP entries that can be processed as logs or nested archives to disk. */
export async function extractZipToDirectory(archivePath, filename, targetPath) {
  const safeTarget = path.resolve(targetPath);
  await fs.mkdir(safeTarget, { recursive: true });
  const extractionPath = await fs.mkdtemp(path.join(safeTarget, 'zip-'));
  const files = [];
  const stream = createReadStream(archivePath).pipe(unzipper.Parse({ forceStream: true }));
  let fileCount = 0;

  try {
    for await (const entry of stream) {
      if (entry.type !== 'File') {
        await entry.autodrain().promise();
        continue;
      }

      fileCount++;
      if (fileCount > MAX_EXTRACTED_FILES) {
        await entry.autodrain().promise();
        throw new ArchiveError('TOO_MANY_FILES', 413,
          `Trop de fichiers dans l'archive (max ${MAX_EXTRACTED_FILES})`);
      }

      const safeName = safeArchiveEntryPath(entry.path, extractionPath);
      const isProcessable = filterLogFiles([{ filename: safeName }]).length > 0 || isArchive(safeName);
      if (!isProcessable) {
        await entry.autodrain().promise();
        continue;
      }

      const destination = path.resolve(extractionPath, ...safeName.split('/'));
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await pipeline(entry, createWriteStream(destination));
      const stats = await fs.stat(destination);
      files.push({ filename: safeName, path: destination, size: stats.size });
    }
  } catch (error) {
    stream.destroy();
    await fs.rm(extractionPath, { recursive: true, force: true }).catch(() => {});
    if (error instanceof ArchiveError) throw error;
    throw mapArchiveError(error);
  }

  if (files.length === 0) {
    await fs.rm(extractionPath, { recursive: true, force: true });
    throw new ArchiveError('NO_LOG_FILES', 400, 'Aucun fichier log trouvé dans l\'archive ZIP.');
  }

  logger.info({ event: 'zip_extracted_to_disk', filename, fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.size, 0) }, '[ARCHIVE]');
  return files;
}

function safeArchiveEntryPath(filename, targetPath) {
  const normalized = String(filename || '').replace(/\\/g, '/');
  if (!normalized || normalized.includes('\0') || normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) {
    throw new ArchiveError('ARCHIVE_INVALID_PATH', 400, 'Chemin de fichier invalide dans l\'archive.');
  }

  const parts = normalized.split('/').filter(part => part && part !== '.');
  if (parts.length === 0 || parts.some(part => part === '..')) {
    throw new ArchiveError('ARCHIVE_INVALID_PATH', 400, 'Chemin de fichier invalide dans l\'archive.');
  }

  const safeName = parts.join('/');
  const resolvedPath = path.resolve(targetPath, ...parts);
  if (!resolvedPath.startsWith(`${path.resolve(targetPath)}${path.sep}`)) {
    throw new ArchiveError('ARCHIVE_INVALID_PATH', 400, 'Chemin de fichier invalide dans l\'archive.');
  }
  return safeName;
}

async function extractZip(buffer) {
  return new Promise((resolve, reject) => {
    const files = [];
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
          /\.(exe|dll|so|dylib|bin|jpe?g|png|gif)$/i.test(filename)) {
        entry.autodrain(); return;
      }

      pending++;
      const chunks = [];
      
      entry.on('data', chunk => {
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

async function extractGzip(buffer, filename) {
  const decompressed = await gunzip(buffer);
  
  const innerName = (filename || 'file.log').replace(/\.(gz|gzip)$/i, '') || 'decompressed.log';
  return [{ filename: innerName, content: decompressed }];
}

async function extractTarGz(buffer) {
  const decompressed = await gunzip(buffer);
  return extractWith7z(decompressed, 'archive.tar', '.tar');
}

async function extractTarWith7z(buffer, filename) {
  return extractWith7z(buffer, filename, '.tar');
}

async function extractRar(buffer, filename) {
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

    for (const file of extracted.files) {
      if (file.fileHeader.flags.directory) continue;
      const content = file.extraction;
      if (!content) continue;

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

async function extractWith7z(buffer, filename, ext) {
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
      maxBuffer: 500 * 1024 * 1024
    });

    const files = [];
    const found = await listFilesRecursive(extractDir);

    // Check file count limit
    if (found.length > MAX_EXTRACTED_FILES) {
      throw new ArchiveError('TOO_MANY_FILES', 413,
        `Trop de fichiers dans l'archive (max ${MAX_EXTRACTED_FILES})`);
    }

    for (const filePath of found) {
      const fileExt = path.extname(filePath).slice(1).toLowerCase();
      if (SKIPPED_EXTENSIONS.has(fileExt)) continue;

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
