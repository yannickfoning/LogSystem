import fs from 'fs';

let env = fs.readFileSync('.env', 'utf8');
const lines = env.split('\n');
const updated = lines.map(l => l.startsWith('DB_PASSWORD=') ? 'DB_PASSWORD=' : l);
fs.writeFileSync('.env', updated.join('\n'), 'utf8');
console.log('Reverted DB_PASSWORD to empty for development (acceptable for local XAMPP, CRITICAL for production)');