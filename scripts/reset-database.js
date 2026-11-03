import '../config/loadEnv.js';

import pool from '../config/database.js';
import { runMigrations } from '../lib/database/migrationRunner.js';
import bcrypt from 'bcryptjs';
import logger from '../config/logger.js';

const rounds = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);

async function dropAllTables() {
  const [tables] = await pool.execute(`
    SELECT TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
  `);

  for (const table of tables) {
    const tableName = table.TABLE_NAME;
    await pool.execute(`DROP TABLE IF EXISTS \`${tableName}\``);
    logger.info({ event: 'table_dropped', table: tableName }, '[RESET]');
  }
}

async function createDefaultUsers() {
  const users = [
    {
      email: process.env.DEFAULT_ADMIN_EMAIL || 'admin@logsystem.local',
      password: process.env.DEFAULT_ADMIN_PASSWORD || 'Admin@1234',
      display_name: process.env.DEFAULT_ADMIN_NAME || 'Administrateur',
      role: 'admin',
    },
    {
      email: process.env.DEFAULT_USER_EMAIL || 'user@logsystem.local',
      password: process.env.DEFAULT_USER_PASSWORD || 'User@1234',
      display_name: process.env.DEFAULT_USER_NAME || 'Utilisateur Standard',
      role: 'user',
    },
  ];

  for (const user of users) {
    const passwordHash = await bcrypt.hash(user.password, rounds);
    await pool.execute(
      `INSERT INTO users (email, password_hash, display_name, role, is_active, created_at)
       VALUES (?, ?, ?, ?, 1, NOW())`,
      [user.email, passwordHash, user.display_name, user.role]
    );
    logger.info({ event: 'user_created', email: user.email, role: user.role }, '[RESET]');
  }
}

async function seedDefaultAlertRules() {
  const rules = [
    {
      name: 'Erreur critique système',
      log_level: 'FATAL',
      pattern: '',
      enabled: true,
      priority: 1
    },
    {
      name: 'Erreur base de données',
      log_level: 'ERROR',
      pattern: 'database|mysql|connection',
      enabled: true,
      priority: 2
    },
    {
      name: 'Erreur mémoire',
      log_level: 'ERROR',
      pattern: 'memory|out of|heap',
      enabled: true,
      priority: 2
    }
  ];

  for (const rule of rules) {
    await pool.execute(
      `INSERT INTO alert_rules (name, log_level, pattern_keywords, enabled, priority, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, 1, NOW())`,
      [rule.name, rule.log_level, rule.pattern, rule.enabled ? 1 : 0, rule.priority]
    );
    logger.info({ event: 'alert_rule_seeded', name: rule.name }, '[RESET]');
  }
}

async function resetDatabase() {
  try {
    logger.info({ event: 'reset_start' }, '[RESET] Starting database reset');

    await dropAllTables();
    logger.info({ event: 'tables_dropped' }, '[RESET] All tables dropped');

    await runMigrations();
    logger.info({ event: 'migrations_completed' }, '[RESET] Migrations completed');

    await createDefaultUsers();
    logger.info({ event: 'users_created' }, '[RESET] Default users created');

    await seedDefaultAlertRules();
    logger.info({ event: 'alert_rules_seeded' }, '[RESET] Default alert rules seeded');

    logger.info({ event: 'reset_success' }, '[RESET] Database reset completed successfully');
  } finally {
    await pool.end();
  }
}

const args = process.argv.slice(2);
const confirmFlag = args.includes('--confirm');

if (!confirmFlag) {
  console.log('⚠️  ATTENTION : Cette opération va supprimer TOUTES les tables et recréer la base de données.');
  console.log('Toutes les données seront perdues.');
  console.log();
  console.log('Pour confirmer, utilisez l\'option --confirm :');
  console.log('  node scripts/reset-database.js --confirm');
  process.exit(1);
}

resetDatabase().catch(err => {
  logger.error({ event: 'reset_error', error: err.message }, '[RESET]');
  process.exit(1);
});
