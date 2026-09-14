import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

console.log('Current database configuration:');
console.log('DB_HOST:', process.env.DB_HOST);
console.log('DB_PORT:', process.env.DB_PORT);
console.log('DB_USER:', process.env.DB_USER);
console.log('DB_NAME:', process.env.DB_NAME);
console.log('DB_PASSWORD:', process.env.DB_PASSWORD ? '***SET***' : '***EMPTY***');

// Check if .env file exists
const envPath = '.env';
if (fs.existsSync(envPath)) {
  console.log('\n.env file exists');
  const envContent = fs.readFileSync(envPath, 'utf8');
  const dbLine = envContent.split('\n').find(line => line.startsWith('DB_NAME='));
  if (dbLine) {
    console.log('DB_NAME in .env:', dbLine);
  } else {
    console.log('DB_NAME not found in .env file');
  }
} else {
  console.log('\n.env file does not exist');
}