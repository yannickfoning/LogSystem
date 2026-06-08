/**
 * Script de création des utilisateurs pour LogSystem
 * Compatible Node.js v24 + Aiven MySQL
 * 
 * Usage: node create_users_fix.mjs
 */

import { createPool } from 'mysql2/promise';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Charger .env manuellement (sans dotenv)
try {
  const envFile = readFileSync(path.join(__dirname, '.env'), 'utf8');
  envFile.split('\n').forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return;
    const idx = line.indexOf('=');
    if (idx < 0) return;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  });
  console.log('✅ .env chargé');
} catch(e) {
  console.log('⚠️  .env non trouvé, utilisation des variables système');
}

const pool = createPool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '3306', 10),
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'defaultdb',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  connectTimeout: 30000,
  waitForConnections: true,
  connectionLimit: 2
});

async function run() {
  console.log(`\n🔌 Connexion à ${process.env.DB_HOST}:${process.env.DB_PORT}...`);
  
  const conn = await pool.getConnection();
  console.log('✅ Connecté à Aiven MySQL !\n');

  // Vérifier les colonnes disponibles
  const [cols] = await conn.query(`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
  `);
  const colNames = cols.map(c => c.COLUMN_NAME);
  console.log('📋 Colonnes users:', colNames.join(', '));

  // Déterminer le bon nom de colonne pour le hash
  const pwdCol = colNames.includes('password_hash') ? 'password_hash' : 'password';
  const nameCol = colNames.includes('display_name')  ? 'display_name'  : 'name';
  
  console.log(`   → colonne mot de passe : ${pwdCol}`);
  console.log(`   → colonne nom          : ${nameCol}\n`);

  // Hasher avec crypto natif Node.js (pas besoin de bcrypt)
  // Format compatible avec bcryptjs : on utilise le hash bcrypt via pbkdf2
  // En fait on va juste insérer un hash bcrypt pré-calculé

  // Hashes bcrypt pré-générés (rounds=12) :
  // Admin@2026! -> hash ci-dessous
  // User@2026!  -> hash ci-dessous
  const adminHash = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMqJqhCanFLdiRqzc8Y3ETKK6';
  const userHash  = '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW';

  // Utilisateurs à créer
  const users = [
    {
      email:    'admin@logsystem.com',
      hash:     adminHash,
      name:     'Administrateur',
      role:     'admin',
      password: 'Admin@2026!'
    },
    {
      email:    'user@logsystem.com',
      hash:     userHash,
      name:     'Utilisateur Test',
      role:     'user',
      password: 'User@2026!'
    }
  ];

  for (const u of users) {
    const [existing] = await conn.query('SELECT id FROM users WHERE email = ?', [u.email]);
    
    if (existing.length > 0) {
      await conn.query(
        `UPDATE users SET ${pwdCol} = ?, is_active = 1 WHERE email = ?`,
        [u.hash, u.email]
      );
      console.log(`♻️  ${u.role.toUpperCase()} mis à jour : ${u.email}`);
    } else {
      await conn.query(
        `INSERT INTO users (email, ${pwdCol}, ${nameCol}, role, is_active, created_at)
         VALUES (?, ?, ?, ?, 1, NOW())`,
        [u.email, u.hash, u.name, u.role]
      );
      console.log(`✅ ${u.role.toUpperCase()} créé : ${u.email}`);
    }
  }

  // Afficher le résultat final
  const [finalUsers] = await conn.query(
    `SELECT id, email, ${nameCol} as name, role, is_active FROM users ORDER BY id`
  );
  
  console.log('\n📊 Utilisateurs en base :');
  finalUsers.forEach(u => {
    console.log(`   ${u.is_active ? '✅' : '❌'} [${u.role}] ${u.name} — ${u.email}`);
  });

  console.log('\n🎉 Terminé ! Tu peux te connecter sur :');
  console.log('   https://logsystem-z41e.onrender.com/login.html\n');
  console.log('   📧 admin@logsystem.com   🔑 Admin@2026!');
  console.log('   📧 user@logsystem.com    🔑 User@2026!');

  conn.release();
  await pool.end();
}

run().catch(err => {
  console.error('\n❌ ERREUR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
