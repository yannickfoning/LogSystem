import '../config/loadEnv.js';

import bcrypt from 'bcryptjs';
import pool from '../config/database.js';

const rounds = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);

// UTILISER DES MOTS DE PASSE SÉCURISÉS
// Ces comptes ne doivent PAS être en production
const TEST_USERS_TO_DELETE = [
  'test1@logsystem.local',
  'test2@logsystem.local'
];

async function deleteTestUsers() {
  try {
    console.log('=== SUPPRESSION DES UTILISATEURS DE TEST DE PRODUCTION ===');
    console.log();

    for (const email of TEST_USERS_TO_DELETE) {
      const [result] = await pool.execute(
        'DELETE FROM users WHERE email = ?',
        [email]
      );
      if (result.affectedRows > 0) {
        console.log(`✅ Utilisateur supprimé : ${email}`);
      } else {
        console.log(`⚠️  Utilisateur non trouvé : ${email}`);
      }
    }

    console.log();
    console.log('=== FIN ===');
  } finally {
    await pool.end();
  }
}

async function changeAdminPassword(newPassword) {
  try {
    console.log('=== CHANGEMENT DU MOT DE PASSE ADMIN ===');
    console.log();

    const email = process.env.DEFAULT_ADMIN_EMAIL || 'admin@logsystem.local';
    const passwordHash = await bcrypt.hash(newPassword, rounds);

    const [result] = await pool.execute(
      'UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE email = ?',
      [passwordHash, email]
    );

    if (result.affectedRows > 0) {
      console.log(`✅ Mot de passe admin changé pour : ${email}`);
      console.log(`⚠️  Le nouveau mot de passe est : ${newPassword}`);
      console.log('⚠️  Changez-le à nouveau après la première connexion');
    } else {
      console.log(`❌ Admin non trouvé : ${email}`);
    }

    console.log();
    console.log('=== FIN ===');
  } finally {
    await pool.end();
  }
}

// Lecture des arguments de ligne de commande
const args = process.argv.slice(2);
const command = args[0];

if (command === 'delete-test') {
  deleteTestUsers().catch(err => {
    console.error('[ERREUR]', err.message);
    process.exit(1);
  });
} else if (command === 'change-admin-password' && args[1]) {
  changeAdminPassword(args[1]).catch(err => {
    console.error('[ERREUR]', err.message);
    process.exit(1);
  });
} else {
  console.log('Usage:');
  console.log('  node scripts/secure-production-users.js delete-test');
  console.log('  node scripts/secure-production-users.js change-admin-password <NOUVEAU_MOT_DE_PASSE>');
  console.log();
  console.log('Exemple:');
  console.log('  node scripts/secure-production-users.js delete-test');
  console.log('  node scripts/secure-production-users.js change-admin-password "MonMotDePasseTrèsSécurisé123!"');
  process.exit(1);
}
