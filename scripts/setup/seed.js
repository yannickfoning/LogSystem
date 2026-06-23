import '../../config/loadEnv.js';

import bcrypt from 'bcryptjs';
import pool from '../../config/database.js';

async function main() {
  const rounds = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);

  const adminHash = await bcrypt.hash('Admin@1234', rounds);
  await pool.execute(
    `INSERT INTO users (email, password_hash, display_name, role, is_active)
     VALUES (?, ?, ?, 'admin', 1)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
    ['admin@logsystem.local', adminHash, 'Administrateur']
  );

  const userHash = await bcrypt.hash('User@1234', rounds);
  await pool.execute(
    `INSERT INTO users (email, password_hash, display_name, role, is_active)
     VALUES (?, ?, ?, 'user', 1)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
    ['user@logsystem.local', userHash, 'Utilisateur']
  );

  // Seed alert rules
  await pool.execute(
    `INSERT INTO alert_rules (name, description, condition_type, condition_value, threshold_value, time_window_minutes, severity, cooldown_minutes, is_active, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    ['Erreurs critiques', 'Détecte les erreurs fréquentes', 'level', 'ERROR', 10, 60, 'high', 30, 1]
  );

  await pool.execute(
    `INSERT INTO alert_rules (name, description, condition_type, condition_value, threshold_value, time_window_minutes, severity, cooldown_minutes, is_active, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    ['Volume anormal', 'Détecte un volume de logs inhabituel', 'count', 'all', 5000, 60, 'medium', 60, 1]
  );

  await pool.execute(
    `INSERT INTO alert_rules (name, description, condition_type, condition_value, threshold_value, time_window_minutes, severity, cooldown_minutes, is_active, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    ['Fatal détecté', 'Alerte immédiate sur les logs FATAL', 'level', 'FATAL', 1, 60, 'critical', 15, 1]
  );

  // Seed sample logs
  const sampleLogs = [];
  const now = new Date();
  const services = ['api-gateway', 'auth-service', 'payment-service', 'user-service', 'notification-service', 'db-manager', 'scheduler'];
  const levels = ['DEBUG', 'INFO', 'INFO', 'INFO', 'WARNING', 'ERROR'];
  const messages = [
    'Request processed successfully',
    'User login from IP 192.168.1.100',
    'Database connection established',
    'Cache hit ratio: 95.2%',
    'Response time exceeded threshold: 2340ms',
    'Failed to connect to Redis at 127.0.0.1:6379',
    'Payment gateway timeout after 30s',
    'Invalid JWT token: expired',
    'Memory usage at 87% - approaching limit',
    'Email notification sent to user@example.com',
    'Scheduled job completed in 12.5s',
    'API rate limit exceeded for client 8a7b6c5d',
    'Database deadlock detected in transaction 4521',
    'SSL certificate expiring in 7 days',
    'Container restarted: OOMKilled',
    'Slow query detected: SELECT * FROM logs WHERE timestamp > NOW() - INTERVAL 30 DAY (2340ms)',
    'File upload failed: size exceeds 50MB limit',
    'Permission denied for user admin on resource /api/admin/users',
    'Connection pool exhausted: max connections reached',
    'Health check failed for service payment-service'
  ];

  for (let i = 0; i < 500; i++) {
    const ts = new Date(now.getTime() - Math.random() * 7 * 24 * 60 * 60 * 1000);
    const timestamp = ts.toISOString().slice(0, 19).replace('T', ' ');
    const level = levels[Math.floor(Math.random() * levels.length)];
    const service = services[Math.floor(Math.random() * services.length)];
    const message = messages[Math.floor(Math.random() * messages.length)];
    sampleLogs.push([timestamp, level, service, message]);
  }

  for (const [timestamp, level, service, message] of sampleLogs) {
    await pool.execute(
      'INSERT INTO logs (timestamp, log_level, source, service, message, user_id) VALUES (?, ?, ?, ?, ?, ?)',
      [timestamp, level, 'seed', service, message, 1]
    );
  }

  console.log('[SEED] Seed data inserted successfully');
  console.log('[SEED] Admin: admin@logsystem.local / Admin@1234');
  console.log('[SEED] User:  user@logsystem.local / User@1234');
  await pool.end();
}

main().catch(e => {
  console.error('[SEED] Error:', e.message);
  process.exit(1);
});
