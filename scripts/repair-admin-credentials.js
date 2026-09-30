import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const users = [
  {
    email: process.env.DEFAULT_ADMIN_EMAIL || 'admin@logsystem.local',
    password: process.env.DEFAULT_ADMIN_PASSWORD || 'Admin@1234',
    display_name: process.env.DEFAULT_ADMIN_NAME || 'Administrateur',
    role: 'admin',
    is_active: 1,
  },
  {
    email: process.env.DEFAULT_USER_EMAIL || 'user@logsystem.local',
    password: process.env.DEFAULT_USER_PASSWORD || 'User@1234',
    display_name: process.env.DEFAULT_USER_NAME || 'Utilisateur Standard',
    role: 'user',
    is_active: 1,
  },
];

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'logsystem',
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
});

async function main() {
  const rounds = Number(process.env.BCRYPT_ROUNDS || 12);

  for (const user of users) {
    const hash = await bcrypt.hash(user.password, rounds);
    const [existing] = await pool.execute('SELECT id FROM users WHERE email = ?', [user.email]);

    if (existing.length > 0) {
      await pool.execute(
        `UPDATE users
         SET password_hash = ?, display_name = ?, role = ?, is_active = ?, session_version = session_version + 1
         WHERE email = ?`,
        [hash, user.display_name, user.role, user.is_active, user.email]
      );
      console.log(`[OK] ${user.email} -> ${user.password}`);
    } else {
      await pool.execute(
        `INSERT INTO users (email, password_hash, display_name, role, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [user.email, hash, user.display_name, user.role, user.is_active]
      );
      console.log(`[NEW] ${user.email} -> ${user.password}`);
    }
  }

  console.log('\nCompte admin attendu: admin@logsystem.local / Admin@1234');
  console.log('Compte user attendu: user@logsystem.local / User@1234');
  await pool.end();
}

main().catch((err) => {
  console.error('ERR', err);
  process.exit(1);
});
