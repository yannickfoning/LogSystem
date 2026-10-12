import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

const connection = await mysql.createConnection({
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: '',
  database: 'log'
});

console.log('=== Checking existing users ===');
const [users] = await connection.execute('SELECT id, email, display_name, role, is_active FROM users');
users.forEach(user => {
  console.log('ID:', user.id, ', Email:', user.email, ', Role:', user.role, ', Active:', user.is_active);
});

if (users.length === 0) {
  console.log('No users found. Creating admin user...');
  const rounds = 12;
  const passwordHash = await bcrypt.hash('Admin@1234', rounds);
  
  const [result] = await connection.execute(
    'INSERT INTO users (email, password_hash, display_name, role, is_active, created_at) VALUES (?, ?, ?, ?, 1, NOW())',
    ['admin@logsystem.local', passwordHash, 'Administrateur', 'admin']
  );
  console.log('Admin user created with ID:', result.insertId);
} else {
  console.log('Users already exist. Updating admin password...');
  const rounds = 12;
  const passwordHash = await bcrypt.hash('Admin@1234', rounds);
  
  await connection.execute(
    'UPDATE users SET password_hash = ? WHERE email = ?',
    [passwordHash, 'admin@logsystem.local']
  );
  console.log('Admin password updated');
}

await connection.end();
