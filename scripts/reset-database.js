import '../config/loadEnv.js';

import pool from '../config/database.js';
import { runMigrations } from '../lib/database/migrationRunner.js';
import bcrypt from 'bcryptjs';
import logger from '../config/logger.js';
import { seedDefaultAlerts, seedDefaultRecommendations } from './setup/seed-default-alerts.js';

const rounds = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);

async function dropAllTables() {
  logger.info({
    event: 'reset_start',
    host: process.env.DB_HOST,
    database: process.env.DB_NAME
  }, '[RESET] Database reset for');

  // Désactiver les vérifications de clés étrangères pour permettre DROP TABLE
  await pool.execute('SET FOREIGN_KEY_CHECKS = 0');

  const [tables] = await pool.execute(`
    SELECT TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
  `);

  for (const table of tables) {
    const tableName = table.TABLE_NAME;
    await pool.execute(`DROP TABLE IF EXISTS \`${tableName}\``);
    logger.info({ event: 'table_dropped', table: tableName }, '[RESET]');
  }

  // Réactiver les vérifications de clés étrangères
  await pool.execute('SET FOREIGN_KEY_CHECKS = 1');
}

async function createDefaultUsers() {
  // Vérifier que les variables d'environnement sont définies
  if (!process.env.DEFAULT_ADMIN_EMAIL || !process.env.DEFAULT_ADMIN_PASSWORD) {
    throw new Error('DEFAULT_ADMIN_EMAIL et DEFAULT_ADMIN_PASSWORD doivent être définis');
  }
  if (!process.env.DEFAULT_USER_EMAIL || !process.env.DEFAULT_USER_PASSWORD) {
    throw new Error('DEFAULT_USER_EMAIL et DEFAULT_USER_PASSWORD doivent être définis');
  }

  const users = [
    {
      email: process.env.DEFAULT_ADMIN_EMAIL,
      password: process.env.DEFAULT_ADMIN_PASSWORD,
      display_name: process.env.DEFAULT_ADMIN_NAME || 'Administrateur',
      role: 'admin',
    },
    {
      email: process.env.DEFAULT_USER_EMAIL,
      password: process.env.DEFAULT_USER_PASSWORD,
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

async function resetDatabase() {
  try {
    await dropAllTables();
    logger.info({ event: 'tables_dropped' }, '[RESET] All tables dropped');

    await runMigrations();
    logger.info({ event: 'migrations_completed' }, '[RESET] Migrations completed');

    await createDefaultUsers();
    logger.info({ event: 'users_created' }, '[RESET] Default users created');

    await seedDefaultAlerts();
    logger.info({ event: 'alert_rules_seeded' }, '[RESET] Default alert rules seeded');

    await seedDefaultRecommendations();
    logger.info({ event: 'recommendations_seeded' }, '[RESET] Default recommendations seeded');

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
