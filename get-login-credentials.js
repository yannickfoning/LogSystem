import pool from './config/database.js';

async function getLoginCredentials() {
  console.log('=== Identifiants de connexion disponibles ===\n');

  const [users] = await pool.execute(
    'SELECT id, email, role, is_active FROM users WHERE is_active = 1 ORDER BY id LIMIT 5'
  );

  console.log('Utilisateurs actifs:');
  users.forEach(user => {
    console.log(`ID: ${user.id}, Email: ${user.email}, Role: ${user.role}, Active: ${user.is_active}`);
  });

  console.log('\nPour tester l\'authentification, utilisez un de ces emails avec son mot de passe.');
  console.log('Note: Les mots de passe sont hashés, donc je ne peux pas les afficher en clair.');
  console.log('Vous devrez utiliser le mot de passe que vous connaissez pour l\'un de ces comptes.');

  process.exit(0);
}

getLoginCredentials().catch(err => {
  console.error('Erreur:', err);
  process.exit(1);
});
