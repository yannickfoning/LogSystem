#!/usr/bin/env node
/**
 * Generate secure passwords and secrets for LogSystem
 * Usage: node scripts/tools/generate-secure-password.js
 */

import crypto from 'crypto';

function generateSecret(length = 64) {
  return crypto.randomBytes(length).toString('hex');
}

function generatePassword(length = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║     LOGSYSTEM - SECURE CREDENTIALS GENERATOR              ║');
console.log('╚════════════════════════════════════════════════════════════╝');
console.log('\n🔐 GENERATED SECRETS (save these securely!):\n');
console.log(`SESSION_SECRET=${generateSecret(64)}`);
console.log(`CSRF_SECRET=${generateSecret(64)}`);
console.log(`DB_PASSWORD=${generatePassword(40)}`);
console.log('\n⚠️  IMPORTANT: Store these in a secure password manager!');
console.log('   Add them to your .env file for local development.');
console.log('   Add them to Vercel environment variables for production.\n');
