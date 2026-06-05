/**
 * Migration Runner — Compatible Aiven MySQL (mysql2 driver)
 * Gère les erreurs d'index dupliqués, colonnes existantes, etc.
 */

import fs from 'fs';
import path from 'path';
import pool from '../../config/database.js';
import logger from '../../config/logger.js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '../../db/migrations');

// Codes d'erreur MySQL à ignorer (migration déjà appliquée)
const IGNORED_CODES = new Set([
  'ER_DUP_FIELDNAME',          // 1060 - colonne existe déjà
  'ER_DUP_KEYNAME',            // 1061 - index existe déjà
  'ER_DUP_ENTRY',              // 1062 - ligne dupliquée (INSERT IGNORE)
  'ER_TABLE_EXISTS_ERROR',     // 1050 - table existe déjà
  'ER_CANT_DROP_FIELD_OR_KEY', // 1091 - index n'existe pas (DROP)
  'ER_UNSUPPORTED_PS',         // commande non supportée en prepared stmt
  'ER_MULTIPLE_PRI_KEY',       // 1068 - clé primaire multiple
]);

const IGNORED_MESSAGES = [
  'already exists',
  'Duplicate column name',
  'Duplicate key name',
  'Multiple primary key',
  'Check that column/key exists',
];

function shouldIgnore(err) {
  if (IGNORED_CODES.has(err.code)) return true;
  return IGNORED_MESSAGES.some(msg => err.message?.includes(msg));
}

function loadMigrations() {
  if (!fs.existsSync(migrationsDir)) {
    logger.warn({ event: 'migrations_dir_not_found', path: migrationsDir }, '[MIGRATION]');
    return [];
  }
  return fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(file => ({
      name: file,
      path: path.join(migrationsDir, file),
      content: fs.readFileSync(path.join(migrationsDir, file), 'utf8')
    }));
}

async function runMigration(conn, migration) {
  try {
    logger.info({ event: 'running_migration', name: migration.name }, '[MIGRATION]');

    // Split on semicolons, filter empty/comment-only lines
    // Also skip DELIMITER lines (not supported by mysql2)
    const statements = migration.content
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .filter(s => !/^--/.test(s))
      .filter(s => !/^\/\*/.test(s))
      .filter(s => !/^DELIMITER/i.test(s))
      .filter(s => !/^SET\s+NAMES/i.test(s));

    let stmtErrors = 0;
    for (const statement of statements) {
      if (!statement || statement.length < 3) continue;
      try {
        await conn.execute(statement);
      } catch (stmtErr) {
        if (shouldIgnore(stmtErr)) {
          logger.warn({
            event: 'migration_stmt_skipped',
            name: migration.name,
            code: stmtErr.code,
            stmt: statement.slice(0, 100)
          }, '[MIGRATION]');
        } else {
          stmtErrors++;
          logger.error({
            event: 'migration_stmt_failed',
            name: migration.name,
            code: stmtErr.code,
            error: stmtErr.message,
            stmt: statement.slice(0, 150)
          }, '[MIGRATION]');
        }
      }
    }

    if (stmtErrors === 0) {
      logger.info({ event: 'migration_completed', name: migration.name }, '[MIGRATION]');
      return true;
    } else {
      logger.warn({ event: 'migration_partial', name: migration.name, stmtErrors }, '[MIGRATION]');
      return false;
    }

  } catch (e) {
    logger.error({
      event: 'migration_error',
      name: migration.name,
      error: e.message,
      code: e.code
    }, '[MIGRATION]');
    if (shouldIgnore(e)) {
      logger.info({ event: 'migration_already_applied', name: migration.name }, '[MIGRATION]');
      return true;
    }
    return false;
  }
}

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
      const ok = await runMigration(conn, migration);
      ok ? successful++ : failed++;
    }

    logger.info({ event: 'migrations_completed', total: migrations.length, successful, failed }, '[MIGRATION]');
    return true; // Never block startup due to migration errors
  } catch (e) {
    logger.error({ event: 'migration_runner_error', error: e.message }, '[MIGRATION]');
    return true; // Continue anyway
  } finally {
    if (conn) try { conn.release(); } catch (_) {}
  }
}

export default { runMigrations };
