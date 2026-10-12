// Script de validation de la configuration Docker
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

console.log('=== Docker Configuration Validation ===\n');

let issues = [];
let warnings = [];

// 1. Vérifier les fichiers requis
console.log('1. Checking required Docker files...');
const requiredDockerFiles = [
  'Dockerfile',
  'docker-compose.yml',
  '.env.docker'
];

for (const file of requiredDockerFiles) {
  const filePath = path.join(projectRoot, file);
  if (fs.existsSync(filePath)) {
    console.log(`   ✅ ${file} exists`);
  } else {
    issues.push(`Missing Docker file: ${file}`);
    console.log(`   ❌ ${file} missing`);
  }
}

// 2. Vérifier Dockerfile
console.log('\n2. Checking Dockerfile...');
const dockerfilePath = path.join(projectRoot, 'Dockerfile');
if (fs.existsSync(dockerfilePath)) {
  const dockerfileContent = fs.readFileSync(dockerfilePath, 'utf-8');
  
  const requiredDockerfileInstructions = [
    'FROM node:',
    'WORKDIR /app',
    'npm install',
    'COPY',
    'EXPOSE',
    'CMD'
  ];
  
  for (const instruction of requiredDockerfileInstructions) {
    if (dockerfileContent.includes(instruction)) {
      console.log(`   ✅ Contains ${instruction}`);
    } else {
      warnings.push(`Dockerfile missing ${instruction}`);
      console.log(`   ⚠️  Missing ${instruction}`);
    }
  }
}

// 3. Vérifier docker-compose.yml
console.log('\n3. Checking docker-compose.yml...');
const composePath = path.join(projectRoot, 'docker-compose.yml');
if (fs.existsSync(composePath)) {
  const composeContent = fs.readFileSync(composePath, 'utf-8');
  
  const requiredServices = ['app', 'mysql', 'redis'];
  for (const service of requiredServices) {
    if (composeContent.includes(service)) {
      console.log(`   ✅ Service ${service} defined`);
    } else {
      issues.push(`Missing service: ${service}`);
      console.log(`   ❌ Service ${service} missing`);
    }
  }
  
  // Vérifier les healthchecks
  if (composeContent.includes('healthcheck')) {
    console.log(`   ✅ Healthchecks configured`);
  } else {
    warnings.push('No healthchecks configured');
    console.log(`   ⚠️  No healthchecks`);
  }
  
  // Vérifier les volumes
  if (composeContent.includes('volumes:')) {
    console.log(`   ✅ Volumes configured`);
  } else {
    warnings.push('No volumes configured');
    console.log(`   ⚠️  No volumes`);
  }
}

// 4. Vérifier .env.docker
console.log('\n4. Checking .env.docker...');
const envDockerPath = path.join(projectRoot, '.env.docker');
if (fs.existsSync(envDockerPath)) {
  const envContent = fs.readFileSync(envDockerPath, 'utf-8');
  
  const requiredEnvVars = [
    'DB_HOST=mysql',
    'DB_PASSWORD=',
    'REDIS_HOST=redis',
    'REDIS_PASSWORD=',
    'SESSION_SECRET=',
    'CSRF_SECRET='
  ];
  
  for (const varPattern of requiredEnvVars) {
    const varName = varPattern.split('=')[0];
    if (envContent.includes(varPattern)) {
      // Vérifier que ce n'est pas une valeur par défaut
      const lines = envContent.split('\n');
      const line = lines.find(l => l.startsWith(varName));
      if (line && (line.includes('CHANGE_THIS') || line.includes('REPLACE_WITH'))) {
        warnings.push(`${varName} has default value - should be changed in production`);
        console.log(`   ⚠️  ${varName} has default value`);
      } else {
        console.log(`   ✅ ${varName} configured`);
      }
    } else {
      issues.push(`Missing env var: ${varName}`);
      console.log(`   ❌ ${varName} missing`);
    }
  }
} else {
  issues.push('.env.docker file missing');
  console.log(`   ❌ .env.docker missing`);
}

// 5. Vérifier les scripts PowerShell
console.log('\n5. Checking Docker scripts...');
const dockerScripts = [
  'docker-setup.ps1',
  'docker-stop.ps1',
  'docker-logs.ps1',
  'docker-reset.ps1',
  'docker-shell.ps1'
];

for (const script of dockerScripts) {
  const scriptPath = path.join(projectRoot, script);
  if (fs.existsSync(scriptPath)) {
    console.log(`   ✅ ${script} exists`);
  } else {
    warnings.push(`Docker script missing: ${script}`);
    console.log(`   ⚠️  ${script} missing`);
  }
}

// 6. Vérifier les ports
console.log('\n6. Checking port configuration...');
const composePath2 = path.join(projectRoot, 'docker-compose.yml');
if (fs.existsSync(composePath2)) {
  const composeContent = fs.readFileSync(composePath2, 'utf-8');
  
  if (composeContent.includes('10000')) {
    console.log(`   ✅ Port 10000 configured`);
  } else {
    warnings.push('Port 10000 not found in docker-compose.yml');
    console.log(`   ⚠️  Port 10000 not configured`);
  }
}

// Résumé
console.log('\n=== Summary ===');
console.log(`Issues: ${issues.length}`);
console.log(`Warnings: ${warnings.length}`);

if (issues.length === 0) {
  console.log('\n✅ Docker configuration is valid!');
  console.log('\nNext steps:');
  console.log('1. Run: .\\docker-setup.ps1');
  console.log('2. Access: http://localhost:10000');
  console.log('3. Login with admin@logsystem.local / Admin@1234');
} else {
  console.log('\n❌ Issues found that need to be fixed:');
  issues.forEach(issue => console.log(`   - ${issue}`));
}

if (warnings.length > 0) {
  console.log('\n⚠️  Warnings (non-blocking):');
  warnings.forEach(warning => console.log(`   - ${warning}`));
}

process.exit(issues.length > 0 ? 1 : 0);
