import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { PROJECT_ROOT } from './project-root.js';

process.env.NODE_ENV ||= 'test';
process.env.SESSION_SECRET ||= 'build_check_session_secret_at_least_32_chars';
process.env.CSRF_SECRET ||= 'build_check_csrf_secret_at_least_32_chars';
process.env.DB_SSL ||= 'false';
process.env.RUN_MIGRATIONS_ON_START ||= 'false';
process.env.START_BACKGROUND_JOBS ||= 'false';

const ignoredDirs = new Set(['.git', 'node_modules', '.vercel', 'logs']);

function collectJsFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectJsFiles(fullPath, files);
    } else if (/\.(js|mjs)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

const files = collectJsFiles(PROJECT_ROOT);

// Bundle unrar.wasm for Vercel serverless (RAR extraction)
const wasmSources = [
  path.join(PROJECT_ROOT, 'node_modules', 'node-unrar-js', 'dist', 'js', 'unrar.wasm'),
  path.join(PROJECT_ROOT, 'node_modules', 'node-unrar-js', 'js', 'unrar.wasm'),
];
const wasmDestDir = path.join(PROJECT_ROOT, 'lib', 'assets');
const wasmDest = path.join(wasmDestDir, 'unrar.wasm');
for (const src of wasmSources) {
  if (fs.existsSync(src)) {
    fs.mkdirSync(wasmDestDir, { recursive: true });
    fs.copyFileSync(src, wasmDest);
    console.log(`Copied unrar.wasm to ${wasmDest}`);
    break;
  }
}

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

await import(pathToFileURL(path.join(PROJECT_ROOT, 'server.js')).href);
console.log(`Build validation passed (${files.length} JS files checked).`);
process.exit(0);
