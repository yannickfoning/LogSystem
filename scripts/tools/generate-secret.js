import crypto from 'crypto';

// Générer un secret sécurisé de 64 caractères pour la session
const secret = crypto.randomBytes(32).toString('hex');
console.log('SESSION_SECRET généré :');
console.log(secret);
console.log('\nAjoutez cette ligne à votre fichier .env :');
console.log(`SESSION_SECRET=${secret}`);
