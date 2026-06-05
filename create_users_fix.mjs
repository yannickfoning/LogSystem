import { createPool } from 'mysql2/promise';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

try {
  const envFile = readFileSync(path.join(__dirname, '.env'), 'utf8');
  envFile.split('\n').forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return;
    const idx = line.indexOf('=');
    if (idx < 0) return;
    process.env[line.slice(0,idx).trim()] = line.slice(idx+1).trim();
  });
  console.log('✅ .env chargé');
} catch(e) { console.log('⚠️ .env non trouvé'); }

const pool = createPool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT, 10),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false },
  connectTimeout: 30000,
  connectionLimit: 2
});

async function run() {
  console.log('🔌 Connexion...');
  const conn = await pool.getConnection();
  console.log('✅ Connecté !');

  const adminHash = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMqJqhCanFLdiRqzc8Y3ETKK6';
  const userHash  = '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW';

  await conn.query("INSERT INTO users (email,password_hash,display_name,role,is_active,created_at) VALUES ('admin@logsystem.com',?,'Administrateur','admin',1,NOW()) ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash),is_active=1",[adminHash]);
  console.log('✅ Admin créé');

  await conn.query("INSERT INTO users (email,password_hash,display_name,role,is_active,created_at) VALUES ('user@logsystem.com',?,'Utilisateur Test','user',1,NOW()) ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash),is_active=1",[userHash]);
  console.log('✅ User créé');

  const [rows] = await conn.query('SELECT email,role FROM users');
  rows.forEach(r => console.log(' -', r.role, ':', r.email));

  conn.release();
  await pool.end();
  console.log('🎉 Terminé !');
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
