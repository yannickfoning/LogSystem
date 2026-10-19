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
const MIGRATION_HISTORY_TABLE = 'schema_migrations';

function isManualMigration(name) {
  return /\.manual\.sql$/i.test(name);
}

function isPlatformResetMigration(name) {
  return /(?:^|\/)20260705_reset_platform\.sql$/i.test(name);
}

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
    .filter(f => f.endsWith('.sql') && !f.endsWith('.disabled') && !isManualMigration(f))
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

async function ensureMigrationHistory(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATION_HISTORY_TABLE} (
      name VARCHAR(255) PRIMARY KEY,
      status ENUM('applied', 'baseline') NOT NULL DEFAULT 'applied',
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
}

async function getMigrationHistoryCount(conn) {
  const [rows] = await conn.query(`SELECT COUNT(*) AS count FROM ${MIGRATION_HISTORY_TABLE}`);
  return Number(rows[0]?.count || 0);
}

async function isEmptyApplicationDatabase(conn) {
  const [rows] = await conn.query(`
    SELECT
      (SELECT COUNT(*) FROM users) AS users_count,
      (SELECT COUNT(*) FROM logs) AS logs_count,
      (SELECT COUNT(*) FROM import_jobs) AS imports_count,
      (SELECT COUNT(*) FROM alerts) AS alerts_count,
      (SELECT COUNT(*) FROM alert_rules) AS rules_count
  `);
  return Object.values(rows[0] || {}).every(value => Number(value) === 0);
}

async function recordMigration(conn, name, status = 'applied') {
  await conn.execute(
    `INSERT IGNORE INTO ${MIGRATION_HISTORY_TABLE} (name, status) VALUES (?, ?)`,
    [name, status]
  );
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
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Migration timeout after 15s')), 15000)
  );
  
  async function runMigrationsInternal() {
    let conn;
    try {
      conn = await pool.getConnection();
      const databaseHadTables = await databaseHasTables(conn);
      const includeSchema = !databaseHadTables;
      if (!includeSchema) {
        logger.info({ event: 'schema_skipped_existing_db', schema: 'db/schema.sql' }, '[MIGRATION]');
      }

      const migrations = loadMigrations({ includeSchema });
      await ensureMigrationHistory(conn);

      const historyCount = await getMigrationHistoryCount(conn);
      const emptyApplicationDatabase = databaseHadTables && historyCount === 0
        ? await isEmptyApplicationDatabase(conn)
        : !databaseHadTables;

      // Existing databases predate migration tracking. Their current migration files
      // have already been replayed by older versions of this runner; baseline them
      // once instead of replaying data-changing SQL on every container start.
      if (databaseHadTables && historyCount === 0 && !emptyApplicationDatabase) {
        for (const migration of migrations) {
          await recordMigration(conn, migration.name, 'baseline');
        }
        logger.warn({
          event: 'migration_history_baselined',
          count: migrations.length,
          reason: 'existing_database_without_migration_history'
        }, '[MIGRATION]');
        await verifyRequiredTables(conn);
        return true;
      }

      if (migrations.length === 0) {
        logger.info({ event: 'no_migrations_found' }, '[MIGRATION]');
        await verifyRequiredTables(conn);
        return true;
      }
      logger.info({ event: 'starting_migrations', count: migrations.length }, '[MIGRATION]');
      let successful = 0, failed = 0, skipped = 0;
      const [appliedRows] = await conn.query(`SELECT name FROM ${MIGRATION_HISTORY_TABLE}`);
      const appliedMigrations = new Set(appliedRows.map(row => row.name));
      for (const migration of migrations) {
        if (appliedMigrations.has(migration.name)) {
          skipped++;
          continue;
        }

        // This historical script resets every application table. Keep it available
        // for an empty first install only; never run it against an existing database.
        if (isPlatformResetMigration(migration.name) && !emptyApplicationDatabase) {
          await recordMigration(conn, migration.name, 'baseline');
          logger.warn({ event: 'destructive_migration_skipped', name: migration.name }, '[MIGRATION]');
          successful++;
          continue;
        }

        const ok = await runMigration(conn, migration);
        if (ok) {
          await recordMigration(conn, migration.name);
          appliedMigrations.add(migration.name);
          successful++;
        } else {
          failed++;
        }
      }
      logger.info({ event: 'migrations_completed', total: migrations.length, successful, failed, skipped }, '[MIGRATION]');
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

  try {
    await Promise.race([runMigrationsInternal(), timeout]);
  } catch (e) {
    const isDevelopment = process.env.NODE_ENV !== 'production';
    const isVercel = !!(process.env.VERCEL || process.env.VERCEL_ENV);
    const isRender = !!(process.env.RENDER || process.env.RENDER_SERVICE_NAME);
    
    // In production, always fail loudly on migration errors
    if (!isDevelopment) {
      logger.fatal({ event: 'migration_failed', error: e.message }, '[MIGRATION] Critical migration failure in production');
      throw e;
    }
    
    // In development on cloud platforms, log as warning but continue
    if (isVercel || isRender) {
      logger.warn({ event: 'migration_warning', error: e.message }, '[MIGRATION] Migration failed on cloud platform in development');
      return;
    }
    
    // In local development, fail loudly to catch issues early
    logger.error({ event: 'migration_failed', error: e.message }, '[MIGRATION] Migration failed in local development');
    throw e;
  }
}

export default { runMigrations };
