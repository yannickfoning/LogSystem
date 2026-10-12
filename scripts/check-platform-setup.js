// Script de diagnostic pour vérifier la configuration de la plateforme LogSystem
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

console.log('=== LogSystem Platform Setup Diagnostic ===\n');

let issues = [];
let warnings = [];

// 1. Vérifier les variables d'environnement requises
console.log('1. Checking required environment variables...');
const requiredVars = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'SESSION_SECRET', 'CSRF_SECRET'];
for (const varName of requiredVars) {
  const value = process.env[varName];
  if (!value || value === '' || value.includes('REPLACE_WITH')) {
    issues.push(`Missing or invalid ${varName}`);
    console.log(`   ❌ ${varName}: ${value ? 'DEFAULT VALUE - MUST BE CHANGED' : 'MISSING'}`);
  } else {
    console.log(`   ✅ ${varName}: ${varName.includes('SECRET') || varName.includes('PASSWORD') ? 'SET (hidden)' : value}`);
  }
}

// 2. Vérifier la connexion MySQL
console.log('\n2. Testing MySQL connection...');
try {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'logsystem',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } : false
  });
  
  console.log('   ✅ MySQL connection successful');
  
  // Vérifier si la base de données existe
  const [databases] = await connection.query('SHOW DATABASES');
  const dbExists = databases.some(db => db.Database === (process.env.DB_NAME || 'logsystem'));
  
  if (dbExists) {
    console.log(`   ✅ Database '${process.env.DB_NAME || 'logsystem'}' exists`);
    
    // Vérifier les tables
    await connection.query(`USE ${process.env.DB_NAME || 'logsystem'}`);
    const [tables] = await connection.query('SHOW TABLES');
    console.log(`   ✅ ${tables.length} tables found`);
    
    // Tables requises
    const requiredTables = ['users', 'logs', 'import_jobs', 'sessions', 'alert_rules'];
    for (const table of requiredTables) {
      const tableExists = tables.some(t => Object.values(t)[0] === table);
      if (tableExists) {
        console.log(`      ✅ Table '${table}' exists`);
      } else {
        issues.push(`Missing required table: ${table}`);
        console.log(`      ❌ Table '${table}' missing`);
      }
    }
  } else {
    issues.push(`Database '${process.env.DB_NAME || 'logsystem'}' does not exist`);
    console.log(`   ❌ Database '${process.env.DB_NAME || 'logsystem'}' does not exist`);
  }
  
  await connection.end();
} catch (error) {
  issues.push(`MySQL connection failed: ${error.message}`);
  console.log(`   ❌ MySQL connection failed: ${error.message}`);
  console.log(`   Code: ${error.code}`);
  
  if (error.code === 'ECONNREFUSED') {
    console.log(`   💡 Tip: Make sure MySQL server is running`);
    console.log(`   💡 On Windows: Check if MySQL service is started in Services`);
  } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
    console.log(`   💡 Tip: Check DB_USER and DB_PASSWORD in .env`);
  } else if (error.code === 'ER_BAD_DB_ERROR') {
    console.log(`   💡 Tip: Database does not exist. Run migration to create it`);
  }
}

// 3. Vérifier les ports
console.log('\n3. Checking port availability...');
const port = parseInt(process.env.PORT || '3001', 10);
console.log(`   Target port: ${port}`);
console.log(`   💡 Tip: Ensure port ${port} is not already in use`);

// 4. Résumé
console.log('\n=== Summary ===');
console.log(`Issues found: ${issues.length}`);
console.log(`Warnings: ${warnings.length}`);

if (issues.length === 0) {
  console.log('\n✅ Platform setup looks good! You can run: npm start');
} else {
  console.log('\n❌ Issues found that need to be fixed:');
  issues.forEach(issue => console.log(`   - ${issue}`));
  console.log('\n💡 Next steps:');
  console.log('   1. Make sure MySQL is installed and running');
  console.log('   2. Update .env with correct database credentials');
  console.log('   3. Run: npm run create-admin (to create default users)');
  console.log('   4. Run: npm start (to start the server)');
}

process.exit(issues.length > 0 ? 1 : 0);
