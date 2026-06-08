import path from 'path';
import fs from 'fs/promises';
import decompress from 'decompress';
import unzipper from 'unzipper';
import sevenZip from '7zip-min';
import { createExtractorFromData } from 'node-unrar-js';

interface ArchiveResult {
  files: Array<{ name: string; content: string; size?: number; modifiedAt?: Date }>;
  totalFiles: number;
}

const TEXT_EXTENSIONS = ['.log', '.txt', '.json', '.jsonl', '.csv', '.xml'];

function isTextFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return TEXT_EXTENSIONS.includes(ext) || ext === '' || ext === '.syslog';
}

function isArchive(filename: string): boolean {
  return ['.zip', '.tar', '.gz', '.tgz', '.tar.gz', '.rar', '.7z'].some((ext) => filename.toLowerCase().endsWith(ext));
}

function unpack7z(filePath: string, tmpDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sevenZip.unpack(filePath, tmpDir, (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export async function extractArchive(
  filePath: string,
  originalFilename: string
): Promise<ArchiveResult> {
  const lowerName = originalFilename.toLowerCase();
  const files: Array<{ name: string; content: string; size?: number; modifiedAt?: Date }> = [];

  try {
    if (lowerName.endsWith('.zip') || lowerName.endsWith('.tar') || lowerName.endsWith('.gz') || lowerName.endsWith('.tgz') || lowerName.endsWith('.tar.gz')) {
      const result = await decompress(filePath);
      for (const file of result) {
        if (!file.path.startsWith('__MACOSX') && isTextFile(file.path)) {
          files.push({
            name: file.path,
            content: file.data.toString('utf-8'),
            size: file.data.length,
            modifiedAt: file.mtime,
          });
        }
      }
    } else if (lowerName.endsWith('.rar')) {
      try {
        const source = await fs.readFile(filePath);
        const data = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
        const extractor = await createExtractorFromData({ data });
        const extracted = extractor.extract();
        for (const file of extracted.files) {
          if (file.fileHeader.flags.directory) continue;
          const name = file.fileHeader.name;
          if (!name.startsWith('__MACOSX') && isTextFile(name) && file.extraction) {
            const buffer = Buffer.from(file.extraction);
            files.push({
              name,
              content: buffer.toString('utf-8'),
              size: buffer.length,
              modifiedAt: file.fileHeader.time ? new Date(file.fileHeader.time) : undefined,
            });
          }
        }
      } catch {
        const tmpDir = filePath + '_extracted';
        await unpack7z(filePath, tmpDir);
        await readDirectoryRecursive(tmpDir, files);
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    } else if (lowerName.endsWith('.7z')) {
      const tmpDir = filePath + '_extracted';
      await unpack7z(filePath, tmpDir);
      await readDirectoryRecursive(tmpDir, files);
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  } catch (error) {
    console.error('Archive extraction error:', error);
  }

  return {
    files,
    totalFiles: files.length,
  };
}

async function readDirectoryRecursive(
  dir: string,
  files: Array<{ name: string; content: string; size?: number; modifiedAt?: Date }>,
  basePath: string = ''
): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('__MACOSX')) {
        await readDirectoryRecursive(fullPath, files, relativePath);
      }
    } else if (isTextFile(entry.name)) {
      const content = await fs.readFile(fullPath, 'utf-8');
      const stat = await fs.stat(fullPath);
      files.push({ name: relativePath, content, size: stat.size, modifiedAt: stat.mtime });
    }
  }
}

export { isArchive, isTextFile };
