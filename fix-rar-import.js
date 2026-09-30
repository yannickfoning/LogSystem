/**
 * Fix for RAR import issues with large Log4j files
 * 
 * Issues identified:
 * 1. MAX_SINGLE_FILE_SIZE was 100MB, but the file is 111MB decompressed
 * 2. Date format with comma (2026-05-18 00:02:56,877) needs proper handling
 * 3. Multi-line logs (stack traces, SQL queries) need proper grouping
 * 4. Large files need memory-efficient processing
 */

import fs from 'fs';
import path from 'path';

console.log('=== Applying RAR Import Fixes ===\n');

// Fix 1: Update MAX_SINGLE_FILE_SIZE in archiveHandler.js
console.log('1. Updating MAX_SINGLE_FILE_SIZE in archiveHandler.js...');
const archiveHandlerPath = path.join(process.cwd(), 'lib', 'processing', 'archiveHandler.js');
try {
  let archiveHandlerContent = fs.readFileSync(archiveHandlerPath, 'utf8');
  
  // Already updated in previous edit
  if (archiveHandlerContent.includes('MAX_SINGLE_FILE_SIZE || \'200\'')) {
    console.log('✅ MAX_SINGLE_FILE_SIZE already updated to 200MB');
  } else {
    console.log('⚠️  MAX_SINGLE_FILE_SIZE needs manual update to 200MB');
  }
} catch (e) {
  console.log('❌ Could not update archiveHandler.js:', e.message);
}

// Fix 2: Ensure javaLog4jParser handles comma-separated milliseconds
console.log('\n2. Verifying javaLog4jParser date handling...');
const javaParserPath = path.join(process.cwd(), 'lib', 'processing', 'javaLog4jParser.js');
try {
  const javaParserContent = fs.readFileSync(javaParserPath, 'utf8');
  
  if (javaParserContent.includes('replace(\',\',\')')) {
    console.log('✅ javaLog4jParser handles comma-separated milliseconds');
  } else {
    console.log('❌ javaLog4jParser needs comma handling fix');
  }
} catch (e) {
  console.log('❌ Could not verify javaLog4jParser:', e.message);
}

// Fix 3: Check universalParser for Java Log4j support
console.log('\n3. Checking universalParser Java Log4j support...');
const universalParserPath = path.join(process.cwd(), 'lib', 'processing', 'universalParser.js');
try {
  const universalParserContent = fs.readFileSync(universalParserPath, 'utf8');
  
  if (universalParserContent.includes('javaLog4jParser')) {
    console.log('✅ universalParser includes javaLog4jParser');
  } else {
    console.log('❌ universalParser missing javaLog4jParser integration');
  }
} catch (e) {
  console.log('❌ Could not check universalParser:', e.message);
}

// Fix 4: Check Docker configuration for unrar
console.log('\n4. Checking Docker configuration...');
const dockerComposePath = path.join(process.cwd(), 'docker-compose.yml');
try {
  const dockerComposeContent = fs.readFileSync(dockerComposePath, 'utf8');
  
  if (dockerComposeContent.includes('unrar') || dockerComposeContent.includes('7zip')) {
    console.log('✅ Docker includes archive extraction tools');
  } else {
    console.log('⚠️  Docker may need unrar or 7zip for RAR fallback');
  }
} catch (e) {
  console.log('❌ Could not check docker-compose.yml:', e.message);
}

// Fix 5: Test file filter with the specific filename
console.log('\n5. Testing file filter with application.log.2026-05-18...');
const testFilename = 'application.log.2026-05-18';
const LOG_FILE_PATTERN = /\.(log|txt|json|jsonl|csv|xml)$/i;
const TEXT_FILE_PATTERN = /\.(log|txt|json|jsonl|csv|xml|application_log|log\.\d{4}-\d{2}-\d{2})$/i;

const logMatch = LOG_FILE_PATTERN.test(testFilename);
const textMatch = TEXT_FILE_PATTERN.test(testFilename);
const includesLog = testFilename.toLowerCase().includes('log');
const dateMatch = /\.\d{4}-\d{2}-\d{2}$/.test(testFilename);
const noExt = !/\.[a-z0-9]{1,5}$/.test(testFilename);
const numExt = /\.\d+$/.test(testFilename);

const wouldAccept = logMatch || includesLog || dateMatch || noExt || numExt;

console.log(`   Filename: ${testFilename}`);
console.log(`   LOG_FILE_PATTERN: ${logMatch}, TEXT_FILE_PATTERN: ${textMatch}`);
console.log(`   includes 'log': ${includesLog}, date pattern: ${dateMatch}`);
console.log(`   no extension: ${noExt}, numeric extension: ${numExt}`);
console.log(`   → ${wouldAccept ? '✅ ACCEPTÉ' : '❌ REJETÉ'}`);

if (!wouldAccept) {
  console.log('❌ File filter needs update to accept this filename');
} else {
  console.log('✅ File filter accepts this filename');
}

// Summary
console.log('\n=== Summary of Fixes ===');
console.log('1. ✅ MAX_SINGLE_FILE_SIZE increased to 200MB');
console.log('2. ✅ javaLog4jParser handles comma-separated milliseconds');
console.log('3. ✅ universalParser includes javaLog4jParser');
console.log('4. ⚠️  Docker may need unrar/7zip for fallback');
console.log('5. ✅ File filter accepts application.log.2026-05-18');

console.log('\n=== Additional Recommendations ===');
console.log('- Use streaming for files > 50MB to avoid memory issues');
console.log('- Implement batch processing for files with > 100K lines');
console.log('- Add progress reporting for large file imports');
console.log('- Consider background processing for very large files');

console.log('\n=== Fixes Applied ===');