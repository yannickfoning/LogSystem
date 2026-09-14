import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

console.log('=== VARIABLES D\'ENVIRONNEMENT CRITIQUES ===\n');

const criticalVars = [
  'NODE_ENV',
  'PORT', 
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
  'SESSION_SECRET',
  'CSRF_SECRET',
  'REDIS_URL',
  'REDIS_HOST'
];

criticalVars.forEach(varName => {
  const value = process.env[varName];
  if (value === undefined || value === '') {
    console.log(`❌ ${varName}: NON CONFIGURÉ`);
  } else if (varName.includes('SECRET') || varName.includes('PASSWORD')) {
    console.log(`✅ ${varName}: ***CONFIGURÉ***`);
  } else {
    console.log(`✅ ${varName}: ${value}`);
  }
});

console.log('\n=== FICHIER .ENV ===');
if (fs.existsSync('.env')) {
  console.log('✅ Fichier .env existe');
  const envContent = fs.readFileSync('.env', 'utf8');
  const lines = envContent.split('\n').filter(line => line.trim() && !line.startsWith('#'));
  console.log(`   ${lines.length} variables configurées`);
} else {
  console.log('❌ Fichier .env inexistant');
}