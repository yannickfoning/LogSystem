import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(new URL(import.meta.url).pathname);

console.log('=== Diagnostic RAR Import ===\n');

// Test 1: Vérifier le module node-unrar-js
console.log('1. Test node-unrar-js module...');
try {
  const unrar = require('node-unrar-js');
  console.log('✅ node-unrar-js chargé');
  console.log('   Version:', require('node-unrar-js/package.json').version);
  
  // Test 2: Vérifier le chargement WASM
  console.log('\n2. Test chargement WASM...');
  const wasmPaths = [
    path.join(__dirname, 'assets', 'unrar.wasm'),
    path.join(path.dirname(require.resolve('node-unrar-js')), 'dist', 'js', 'unrar.wasm'),
    path.join(path.dirname(require.resolve('node-unrar-js')), 'js', 'unrar.wasm'),
    path.join(process.cwd(), 'node_modules', 'node-unrar-js', 'dist', 'js', 'unrar.wasm'),
    path.join(process.cwd(), 'node_modules', 'node-unrar-js', 'js', 'unrar.wasm'),
  ];
  
  let wasmFound = false;
  for (const p of wasmPaths) {
    try {
      if (fs.existsSync(p)) {
        console.log(`✅ WASM trouvé: ${p}`);
        wasmFound = true;
        break;
      }
    } catch (_) {}
  }
  
  if (!wasmFound) {
    console.log('❌ WASM non trouvé dans aucun des chemins attendus');
    console.log('   Chemins testés:', wasmPaths);
  }
  
  // Test 3: Essayer de charger le WASM
  console.log('\n3. Test extraction WASM...');
  try {
    const { createExtractorFromData } = unrar;
    console.log('✅ createExtractorFromData disponible');
  } catch (e) {
    console.log('❌ createExtractorFromData non disponible:', e.message);
  }
  
} catch (e) {
  console.log('❌ node-unrar-js non chargé:', e.message);
}

// Test 4: Vérifier 7zip-bin
console.log('\n4. Test 7zip-bin...');
try {
  const { path7za } = require('7zip-bin');
  console.log('✅ 7zip-bin chargé');
  console.log('   Chemin:', path7za);
  
  if (fs.existsSync(path7za)) {
    console.log('✅ 7za exécutable existe');
  } else {
    console.log('❌ 7za exécutable non trouvé');
  }
} catch (e) {
  console.log('❌ 7zip-bin non chargé:', e.message);
}

// Test 5: Vérifier les filtres de fichiers
console.log('\n5. Test filtres de fichiers...');
const testFiles = [
  'application.log.2026-05-18',
  'app.log.2026-05-18',
  'error.log',
  'debug.txt',
  'application_log'
];

const LOG_FILE_PATTERN = /\.(log|txt|json|jsonl|csv|xml)$/i;
const TEXT_FILE_PATTERN = /\.(log|txt|json|jsonl|csv|xml|application_log|log\.\d{4}-\d{2}-\d{2})$/i;

console.log('LOG_FILE_PATTERN:', LOG_FILE_PATTERN);
console.log('TEXT_FILE_PATTERN:', TEXT_FILE_PATTERN);

for (const file of testFiles) {
  const logMatch = LOG_FILE_PATTERN.test(file);
  const textMatch = TEXT_FILE_PATTERN.test(file);
  const includesLog = file.toLowerCase().includes('log');
  const dateMatch = /\.\d{4}-\d{2}-\d{2}$/.test(file);
  const noExt = !/\.[a-z0-9]{1,5}$/.test(file);
  const numExt = /\.\d+$/.test(file);
  
  const wouldAccept = logMatch || includesLog || dateMatch || noExt || numExt;
  
  console.log(`   ${file}:`);
  console.log(`     LOG_FILE_PATTERN: ${logMatch}, TEXT_FILE_PATTERN: ${textMatch}`);
  console.log(`     includes 'log': ${includesLog}, date pattern: ${dateMatch}`);
  console.log(`     no extension: ${noExt}, numeric extension: ${numExt}`);
  console.log(`     → ${wouldAccept ? '✅ ACCEPTÉ' : '❌ REJETÉ'}`);
}

// Test 6: Vérifier les limites de configuration
console.log('\n6. Test limites de configuration...');
console.log('MAX_EXTRACTED_FILES:', process.env.MAX_EXTRACTED_FILES || '1000');
console.log('MAX_TOTAL_EXTRACTED_SIZE:', process.env.MAX_TOTAL_EXTRACTED_SIZE || '500MB');
console.log('MAX_SINGLE_FILE_SIZE:', process.env.MAX_SINGLE_FILE_SIZE || '100MB');
console.log('MAX_ARCHIVE_DEPTH:', process.env.MAX_ARCHIVE_DEPTH || '3');

// Test 7: Vérifier le parsing de date
console.log('\n7. Test parsing de date...');
const testDates = [
  '2026-05-18 00:02:56,877',
  '2026-05-18 00:02:56.877',
  '2026-05-18T00:02:56,877',
  '2026-05-18T00:02:56.877'
];

for (const dateStr of testDates) {
  const date = new Date(dateStr);
  console.log(`   "${dateStr}" → ${isNaN(date.getTime()) ? '❌ Invalid Date' : '✅ ' + date.toISOString()}`);
}

console.log('\n=== Diagnostic terminé ===');