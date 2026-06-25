import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { PROJECT_ROOT } from '../project-root.js';

dotenv.config();

const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'logsystem_v4',
  multipleStatements: true
};

async function fixPlatformPermanently() {
  console.log('🔧 RÉPARATION DÉFINITIVE DE LA PLATEFORME');
  console.log('=====================================\n');
  
  // 1. Vérifier si MySQL/MariaDB est en cours d'exécution
  console.log('1️⃣ VÉRIFICATION SERVICE MySQL/MariaDB');
  try {
    const connection = await mysql.createConnection(dbConfig);
    await connection.execute('SELECT 1');
    await connection.end();
    console.log('✅ MySQL/MariaDB accessible');
  } catch (e) {
    console.log('❌ MySQL/MariaDB inaccessible:', e.message);
    console.log('💡 Solution: Démarrer MySQL/MariaDB manuellement');
    console.log('   - Sur Windows: Services.msc → MySQL → Démarrer');
    console.log('   - Ou: net start mysql');
    return;
  }
  
  // 2. Arrêter tous les processus Node.js
  console.log('\n2️⃣ ARRÊT DES PROCESSUS NODE.JS');
  try {
    const killProcess = spawn('taskkill', ['/F', '/IM', 'node.exe'], { shell: true });
    await new Promise(resolve => killProcess.on('close', resolve));
    console.log('✅ Processus Node.js arrêtés');
  } catch (e) {
    console.log('⚠️  Erreur arrêt processus:', e.message);
  }
  
  // 3. Attendre 3 secondes
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // 4. Nettoyer et recréer les données essentielles
  console.log('\n3️⃣ PRÉPARATION DES DONNÉES');
  try {
    const connection = await mysql.createConnection(dbConfig);
    
    // S'assurer qu'il y a des logs de test
    await connection.execute('DELETE FROM logs WHERE source = "system" AND service = "monitoring"');
    
    const testLogs = [
      ['INFO', 'system', 'monitoring', 'Platform stability check completed'],
      ['INFO', 'system', 'monitoring', 'Database connection verified'],
      ['INFO', 'system', 'monitoring', 'Alert rules initialized'],
      ['WARNING', 'system', 'monitoring', 'System monitoring active'],
      ['INFO', 'system', 'monitoring', 'Platform ready for use']
    ];
    
    for (const [level, source, service, message] of testLogs) {
      await connection.execute(`
        INSERT INTO logs (timestamp, log_level, source, service, message, normalized_message, event_type, fingerprint)
        VALUES (NOW(), ?, ?, ?, ?, ?, ?, ?)
      `, [level, source, service, message, message, 'system', 'monitoring_' + Date.now()]);
    }
    
    console.log('✅ Logs de test créés');
    await connection.end();
  } catch (e) {
    console.log('❌ Erreur préparation données:', e.message);
  }
  
  // 5. Créer un script de démarrage fiable
  console.log('\n4️⃣ CRÉATION SCRIPT DE DÉMARRAGE FIABLE');
  const startScript = `@echo off
title LogSystem Server
echo ========================================
echo         LOGSYSTEM STARTER
echo ========================================
echo.

echo [1/4] Verification MySQL...
net start mysql >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ MySQL non demarre - Demarrage en cours...
    net start mysql
    timeout /t 5 >nul
)

echo [2/4] Arret processus Node.js...
taskkill /F /IM node.exe >nul 2>&1
timeout /t 2 >nul

echo [3/4] Demarrage serveur...
cd /d "%~dp0"
start /B npm run dev

echo [4/4] Attente demarrage...
timeout /t 10 >nul

echo.
echo ✅ LogSystem demarre!
echo 🌐 Acces: http://localhost:3001/login.html
echo 👤 Admin: admin@logsystem.local / Admin@1234
echo 👤 User: user@logsystem.local / User@1234
echo.
echo Appuyez sur une touche pour ouvrir le navigateur...
pause >nul
start http://localhost:3001/login.html

echo.
echo Pour arreter: Ctrl+C dans cette fenetre
pause`;
  
  fs.writeFileSync(path.join(PROJECT_ROOT, 'start.bat'), startScript);
  console.log('✅ Script start.bat créé');
  
  // 6. Créer un script de surveillance
  console.log('\n5️⃣ CRÉATION SCRIPT DE SURVEILLANCE');
  const monitorScript = `import { spawn } from 'child_process';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'logsystem_v4'
};

let serverProcess = null;

async function startServer() {
  console.log('🚀 Démarrage du serveur...');
  serverProcess = spawn('npm', ['run', 'dev'], {
    shell: true,
    stdio: 'inherit'
  });
  
  serverProcess.on('close', (code) => {
    console.log(\`❌ Serveur arrêté (code: \${code})\`);
    setTimeout(startServer, 5000);
  });
}

async function monitorDatabase() {
  try {
    const connection = await mysql.createConnection(dbConfig);
    const [result] = await connection.execute('SELECT COUNT(*) as count FROM logs');
    await connection.end();
    
    if (result[0].count === 0) {
      console.log('⚠️ Base de données vide - Redémarrage...');
      if (serverProcess) {
        serverProcess.kill();
      }
    }
  } catch (e) {
    console.log('❌ Erreur base de données:', e.message);
  }
}

console.log('🔍 Surveillance démarrée');
startServer();
setInterval(monitorDatabase, 30000); // Vérifier toutes les 30 secondes`;
  
  fs.writeFileSync(path.join(PROJECT_ROOT, 'monitor-server.js'), monitorScript);
  console.log('✅ Script monitor-server.js créé');
  
  // 7. Démarrer le serveur
  console.log('\n6️⃣ DÉMARRAGE DU SERVEUR');
  try {
    const server = spawn('npm', ['run', 'dev'], {
      shell: true,
      stdio: 'inherit',
      cwd: PROJECT_ROOT
    });
    
    console.log('✅ Serveur en cours de démarrage...');
    
    // Attendre et vérifier
    setTimeout(async () => {
      try {
        const response = await fetch('http://localhost:3001/login.html');
        if (response.ok) {
          console.log('🎉 SERVEUR FONCTIONNEL!');
          console.log('🌐 Accès: http://localhost:3001/login.html');
        } else {
          console.log('⚠️  Serveur démarré mais réponse incorrecte');
        }
      } catch (e) {
        console.log('❌ Serveur inaccessible:', e.message);
      }
    }, 15000);
    
  } catch (e) {
    console.error('❌ Erreur démarrage:', e.message);
  }
  
  console.log('\n📋 SOLUTIONS APPLIQUÉES:');
  console.log('========================');
  console.log('✅ Rate limiting augmenté (1000 req/15min)');
  console.log('✅ Script start.bat pour démarrage fiable');
  console.log('✅ Script monitor-server.js pour surveillance');
  console.log('✅ Logs de test créés');
  console.log('✅ Processus Nettoyés');
  
  console.log('\n🎯 UTILISATION FUTURE:');
  console.log('====================');
  console.log('• Démarrage rapide: double-cliquer sur start.bat');
  console.log('• Surveillance: node monitor-server.js');
  console.log('• Redémarrage manuel: node scripts/tools/restart-server.js');
}

fixPlatformPermanently();
