import dotenv from 'dotenv';
dotenv.config();

import bcrypt from 'bcrypt';
import pool from '../config/database.js';

const adminEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@logsystem.local';
const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'Admin@1234';
const adminName = process.env.DEFAULT_ADMIN_NAME || 'Administrateur';
const rounds = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);

async function ensureDefaultAdmin() {
  let adminId;
  let action;

  try {
    const passwordHash = await bcrypt.hash(adminPassword, rounds);

    const [existing] = await pool.execute(
      'SELECT id FROM users WHERE email = ?',
      [adminEmail]
    );

    if (existing.length > 0) {
      const user = existing[0];
      await pool.execute(
        `UPDATE users
         SET password_hash = ?,
             display_name = ?,
             role = 'admin',
             is_active = 1,
             session_version = session_version + 1
         WHERE id = ?`,
        [passwordHash, adminName, user.id]
      );

      action = 'Administrateur existant mis a jour';
      adminId = user.id;
    } else {
      const [result] = await pool.execute(
        `INSERT INTO users (email, password_hash, display_name, role, is_active, created_at)
         VALUES (?, ?, ?, 'admin', 1, NOW())`,
        [adminEmail, passwordHash, adminName]
      );

      action = 'Administrateur cree';
      adminId = result.insertId;
    }
  } finally {
    await pool.end();
  }

  console.log(`[ADMIN] ${action}`);
  console.log(`[ADMIN] Email: ${adminEmail}`);
  console.log(`[ADMIN] ID: ${adminId}`);
  console.log(`[ADMIN] Mot de passe: ${adminPassword}`);
  console.log('[ADMIN] Changez ce mot de passe apres la premiere connexion.');
}

ensureDefaultAdmin().catch(error => {
  console.error('[ADMIN] Erreur:', error.message);
  process.exit(1);
});
