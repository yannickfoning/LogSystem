/**
 * Migration Runner
 * 
 * Exécute automatiquement les migrations SQL au démarrage du serveur.
 * Chaque migration est idempotente (peut être exécutée plusieurs fois sans danger).
 * 
 * Les migrations sont appliquées dans l'ordre numérique des fichiers.
 */

import fs from 'fs';
import path from 'path';
import pool from '../../config/database.js';
import logger from '../../config/logger.js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '../../db/migrations');

/**
 * Charger toutes les migrations depuis le dossier migrations/
 * Les fichiers doivent être nommés : migration_NNN_description.sql
 * Exemple: migration_001_initial_schema.sql, migration_002_add_columns.sql
 */
function loadMigrations() {
  if (!fs.existsSync(migrationsDir)) {
    logger.warn({ event: 'migrations_dir_not_found', path: migrationsDir }, '[MIGRATION]');
    return [];
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort(); // Sort alphabetically ensures numerical order

  const migrations = [];
  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    migrations.push({
      name: file,
      path: filePath,
      content: content
    });
  }

  return migrations;
}

/**
 * Exécuter une migration SQL
 */
async function runMigration(conn, migration) {
  try {
    logger.info({ event: 'running_migration', name: migration.name }, '[MIGRATION]');
    
    // Diviser par ; pour gérer plusieurs statements
    const statements = migration.content
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const statement of statements) {
      if (statement.length > 0) {
        await conn.execute(statement);
      }
    }

    logger.info({ event: 'migration_completed', name: migration.name }, '[MIGRATION]');
    return true;
  } catch (e) {
    logger.error({ 
      event: 'migration_error', 
      name: migration.name, 
      error: e.message,
      code: e.code
    }, '[MIGRATION]');
    
    // Retourner true si les colonnes existent déjà (ER_DUP_FIELDNAME = 1060)
    if (e.code === 'ER_DUP_FIELDNAME' || e.message.includes('already exists')) {
      logger.info({ event: 'migration_already_applied', name: migration.name }, '[MIGRATION]');
      return true;
    }
    
    return false;
  }
}

/**
 * Exécuter toutes les migrations
 */
export async function runMigrations() {
  let conn;
  try {
    conn = await pool.getConnection();
    const migrations = loadMigrations();

    if (migrations.length === 0) {
      logger.info({ event: 'no_migrations_found' }, '[MIGRATION]');
      return true;
    }

    logger.info({ event: 'starting_migrations', count: migrations.length }, '[MIGRATION]');

    let successful = 0;
    let failed = 0;

    for (const migration of migrations) {
      const success = await runMigration(conn, migration);
      if (success) {
        successful++;
      } else {
        failed++;
      }
    }

    logger.info({ 
      event: 'migrations_completed', 
      total: migrations.length,
      successful,
      failed
    }, '[MIGRATION]');

    return failed === 0;
  } catch (e) {
    logger.error({ event: 'migration_runner_error', error: e.message }, '[MIGRATION]');
    return false;
  } finally {
    if (conn) {
      try { conn.release(); } catch (_) {}
    }
  }
}

export default { runMigrations };
