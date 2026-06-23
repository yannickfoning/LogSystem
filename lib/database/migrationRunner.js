/**
 * Migration Runner — Compatible Aiven MySQL (mysql2 driver)
 * MySQL 5.7+ compatible — no IF NOT EXISTS on ALTER TABLE / CREATE INDEX
 */

import fs from 'fs';
import path from 'path';
import pool from '../../config/database.js';
import logger from '../../config/logger.js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, '../../db/schema.sql');
const migrationsDir = path.join(__dirname, '../../db/migrations');

const IGNORED_CODES = new Set([
  'ER_DUP_FIELDNAME',
  'ER_DUP_KEYNAME',
  'ER_DUP_ENTRY',
  'ER_TABLE_EXISTS_ERROR',
  'ER_CANT_DROP_FIELD_OR_KEY',
  'ER_UNSUPPORTED_PS',
  'ER_MULTIPLE_PRI_KEY',
  'ER_KEY_COLUMN_DOES_NOT_EXITS',
]);

const IGNORED_MESSAGES = [
  'already exists',
  'Duplicate column name',
  'Duplicate key name',
  'Multiple primary key',
  'Check that column/key exists',
];

const REQUIRED_TABLES = [
  'users', 'logs', 'alert_rules', 'alerts', 'import_jobs',
  'audit_log', 'error_groups', 'watch_offsets',
];

function shouldIgnore(err) {
  if (IGNORED_CODES.has(err.code)) return true;
  return IGNORED_MESSAGES.some(msg => err.message?.includes(msg));
}

function loadMigrations({ includeSchema = false } = {}) {
  const migrations = [];

  if (includeSchema && fs.existsSync(schemaPath)) {
    migrations.push({
      name: '000_initial_schema.sql',
      path: schemaPath,
      content: fs.readFileSync(schemaPath, 'utf8')
    });
  }

  if (!fs.existsSync(migrationsDir)) {
    logger.warn({ event: 'migrations_dir_not_found', path: migrationsDir }, '[MIGRATION]');
    return migrations;
  }

  migrations.push(...fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql') && !f.endsWith('.disabled'))
    .sort()
    .map(file => ({
      name: path.relative(path.join(__dirname, '../..'), path.join(migrationsDir, file)).replace(/\\/g, '/'),
      path: path.join(migrationsDir, file),
      content: fs.readFileSync(path.join(migrationsDir, file), 'utf8')
    })));

  return migrations;
}

async function databaseHasTables(conn) {
  const [rows] = await conn.query('SHOW TABLES');
  return rows.length > 0;
}

function stripSqlComments(sql) {
  return sql
    .split(/\r?\n/)
    .filter(line => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith('--') && !trimmed.startsWith('/*') && !trimmed.startsWith('*');
    })
    .join('\n');
}

async function runMigration(conn, migration) {
  try {
    logger.info({ event: 'running_migration', name: migration.name }, '[MIGRATION]');

    const statements = stripSqlComments(migration.content)
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .filter(s => !/^DELIMITER/i.test(s))
      .filter(s => !/^SET\s+NAMES/i.test(s));

    let stmtErrors = 0;
    for (const statement of statements) {
      if (!statement || statement.length < 3) continue;
      try {
        await conn.query(statement);
      } catch (stmtErr) {
        if (shouldIgnore(stmtErr)) {
          logger.warn({ event: 'migration_stmt_skipped', name: migration.name, code: stmtErr.code, stmt: statement.slice(0, 100) }, '[MIGRATION]');
        } else {
          stmtErrors++;
          logger.error({ event: 'migration_stmt_failed', name: migration.name, code: stmtErr.code, error: stmtErr.message, stmt: statement.slice(0, 150) }, '[MIGRATION]');
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
    logger.error({ event: 'migration_error', name: migration.name, error: e.message, code: e.code }, '[MIGRATION]');
    if (shouldIgnore(e)) return true;
    return false;
  }
}

async function verifyRequiredTables(conn) {
  const [rows] = await conn.query('SHOW TABLES');
  const existing = rows.map(r => Object.values(r)[0]);
  const missing = REQUIRED_TABLES.filter(t => !existing.includes(t));
  if (missing.length > 0) {
    throw new Error(`[FATAL] Tables manquantes après migrations: ${missing.join(', ')}`);
  }
}

export async function runMigrations() {
  let conn;
  try {
    conn = await pool.getConnection();
    const includeSchema = !(await databaseHasTables(conn));
    if (!includeSchema) {
      logger.info({ event: 'schema_skipped_existing_db', schema: 'db/schema.sql' }, '[MIGRATION]');
    }

    const migrations = loadMigrations({ includeSchema });
    if (migrations.length === 0) {
      logger.info({ event: 'no_migrations_found' }, '[MIGRATION]');
      await verifyRequiredTables(conn);
      return true;
    }
    logger.info({ event: 'starting_migrations', count: migrations.length }, '[MIGRATION]');
    let successful = 0, failed = 0;
    for (const migration of migrations) {
      const ok = await runMigration(conn, migration);
      ok ? successful++ : failed++;
    }
    logger.info({ event: 'migrations_completed', total: migrations.length, successful, failed }, '[MIGRATION]');
    if (failed > 0) {
      throw new Error(`[FATAL] ${failed} migration(s) ont échoué — voir les logs [MIGRATION]`);
    }
    await verifyRequiredTables(conn);
    return true;
  } catch (e) {
    logger.error({ event: 'migration_runner_error', error: e.message }, '[MIGRATION]');
    throw e;
  } finally {
    if (conn) try { conn.release(); } catch {}
  }
}

export default { runMigrations };
