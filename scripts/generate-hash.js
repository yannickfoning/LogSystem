import bcrypt from 'bcryptjs';

const password = process.argv[2] || 'Admin@1234';
const rounds = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);

const hash = bcrypt.hashSync(password, rounds);
console.log('Password:', password);
console.log('Hash:', hash);
