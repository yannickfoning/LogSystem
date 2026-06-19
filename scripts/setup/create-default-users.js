import dotenv from 'dotenv';
dotenv.config();

import bcrypt from 'bcryptjs';
import pool from '../config/database.js';

const rounds = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);

const USERS = [
  {
    email:        process.env.DEFAULT_ADMIN_EMAIL    || 'admin@logsystem.local',
    password:     process.env.DEFAULT_ADMIN_PASSWORD || 'Admin@1234',
    display_name: process.env.DEFAULT_ADMIN_NAME     || 'Administrateur',
    role:         'admin',
  },
  {
    email:        process.env.DEFAULT_USER_EMAIL    || 'user@logsystem.local',
    password:     process.env.DEFAULT_USER_PASSWORD || 'User@1234',
    display_name: process.env.DEFAULT_USER_NAME     || 'Utilisateur Standard',
    role:         'user',
  },
];

async function ensureUsers() {
  try {
    for (const u of USERS) {
      const passwordHash = await bcrypt.hash(u.password, rounds);

      const [existing] = await pool.execute(
        'SELECT id FROM users WHERE email = ?',
        [u.email]
      );

      if (existing.length > 0) {
        const { id } = existing[0];
        await pool.execute(
          `UPDATE users
           SET password_hash    = ?,
               display_name     = ?,
               role             = ?,
               is_active        = 1,
               session_version  = session_version + 1
           WHERE id = ?`,
          [passwordHash, u.display_name, u.role, id]
        );
        console.log(`[${u.role.toUpperCase()}] Mis à jour  — ID: ${id} | Email: ${u.email} | Mot de passe: ${u.password}`);
      } else {
        const [result] = await pool.execute(
          `INSERT INTO users (email, password_hash, display_name, role, is_active, created_at)
           VALUES (?, ?, ?, ?, 1, NOW())`,
          [u.email, passwordHash, u.display_name, u.role]
        );
        console.log(`[${u.role.toUpperCase()}] Créé       — ID: ${result.insertId} | Email: ${u.email} | Mot de passe: ${u.password}`);
      }
    }

    console.log('\n⚠️  Changez ces mots de passe après la première connexion.');
  } finally {
    await pool.end();
  }
}

ensureUsers().catch(err => {
  console.error('[ERREUR]', err.message);
  process.exit(1);
});
