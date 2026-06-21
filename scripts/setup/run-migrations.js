/**
 * Script à exécuter UNE SEULE FOIS après déploiement Vercel
 * pour appliquer les migrations sur la base Aiven.
 *
 * Usage local :
 *   node scripts/setup/run-migrations.js
 *
 * Ou depuis Vercel CLI :
 *   vercel env pull .env.local
 *   node scripts/setup/run-migrations.js
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

import { runMigrations } from '../../lib/database/migrationRunner.js';
import pool from '../../config/database.js';

console.log('\n[MIGRATION] Connexion à', process.env.DB_HOST, '...\n');

try {
  await runMigrations();
  console.log('\n✅ Migrations terminées.\n');
} catch (e) {
  console.error('\n✗ Erreur migration:', e.message, '\n');
  process.exit(1);
} finally {
  await pool.end();
}