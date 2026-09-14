import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const envPath = '.env';
const envContent = fs.readFileSync(envPath, 'utf8');

// Replace DB_NAME=logsystem with DB_NAME=log
const newEnvContent = envContent.replace(/DB_NAME=logsystem/g, 'DB_NAME=log');

fs.writeFileSync(envPath, newEnvContent);

console.log('Database name changed from logsystem to log in .env file');
console.log('You may need to restart the server for this change to take effect');