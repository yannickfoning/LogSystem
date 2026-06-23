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

async function deepDiagnosis() {
  console.log('🔬 DIAGNOSTIC APPROFONDI - PROBLÈME PERSISTANT');
  console.log('============================================\n');
  
  // 1. Vérifier si le serveur Node.js est en cours d'exécution
  console.log('1️⃣ ÉTAT DU SERVEUR NODE.JS');
  try {
    const response = await fetch('http://localhost:3001/api/dashboard/summary');
    if (response.ok) {
      const data = await response.json();
      console.log('✅ Serveur répond correctement');
      console.log(`📊 Logs dans base: ${data.total_logs}`);
      console.log(`📅 Logs aujourd\'hui: ${data.today_logs}`);
    } else {
      console.log('❌ Serveur répond avec erreur:', response.status);
    }
  } catch (e) {
    console.log('❌ Serveur inaccessible:', e.message);
    console.log('🔍 Le serveur Node.js est probablement crashé');
    
    // Vérifier les processus Node.js
    try {
      const { exec } = require('child_process');
      exec('tasklist | findstr node.exe', (error, stdout, stderr) => {
        if (stdout.includes('node.exe')) {
          console.log('ℹ️  Processus Node.js trouvé mais serveur inaccessible');
          console.log('💡 Possible: Serveur crashé mais processus zombie');
        } else {
          console.log('❌ Aucun processus Node.js trouvé');
          console.log('💡 Solution: Redémarrer le serveur');
        }
      });
    } catch (procError) {
      console.log('⚠️  Impossible de vérifier les processus');
    }
  }
  
  // 2. Vérifier la base de données directement
  console.log('\n2️⃣ CONNEXION DIRECTE BASE DE DONNÉES');
  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);
    const [tables] = await connection.execute('SHOW TABLES');
    console.log('✅ Base de données accessible');
    console.log(`📋 Tables trouvées: ${tables.length}`);
    
    const [logCount] = await connection.execute('SELECT COUNT(*) as count FROM logs');
    console.log(`📊 Logs dans base: ${logCount[0].count}`);
    
    if (logCount[0].count === 0) {
      console.log('⚠️  Base vide - Création de logs de test...');
      await createTestLogs(connection);
    }
    
  } catch (e) {
    console.log('❌ Erreur base de données:', e.message);
  } finally {
    if (connection) await connection.end();
  }
  
  // 3. Vérifier les erreurs JavaScript possibles
  console.log('\n3️⃣ VÉRIFICATION ERREURS JAVASCRIPT');
  try {
    const loginHtml = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'login.html'), 'utf8');
    
    // Vérifier les erreurs JavaScript courantes
    const jsIssues = [];
    
    if (loginHtml.includes('window.i18n') && !loginHtml.includes('i18n.js')) {
      jsIssues.push('i18n.js manquant');
    }
    
    if (loginHtml.includes('api.js') && !fs.existsSync(path.join(PROJECT_ROOT, 'public', 'api.js'))) {
      jsIssues.push('api.js manquant');
    }
    
    if (loginHtml.includes('monitoring.js') && !fs.existsSync(path.join(PROJECT_ROOT, 'public', 'monitoring.js'))) {
      jsIssues.push('monitoring.js manquant');
    }
    
    if (jsIssues.length > 0) {
      console.log('⚠️  Problèmes JavaScript détectés:');
      jsIssues.forEach(issue => console.log(`  - ${issue}`));
    } else {
      console.log('✅ Aucun problème JavaScript détecté');
    }
    
  } catch (e) {
    console.log('❌ Erreur lecture fichiers:', e.message);
  }
  
  // 4. Vérifier la mémoire et ressources
  console.log('\n4️⃣ VÉRIFICATION RESSOURCES SYSTÈME');
  try {
    const { exec } = require('child_process');
    exec('wmic OS get TotalVisibleMemorySize,FreePhysicalMemory /value', (error, stdout) => {
      if (!error) {
        const lines = stdout.split('\n');
        const totalMem = lines.find(l => l.includes('TotalVisibleMemorySize'));
        const freeMem = lines.find(l => l.includes('FreePhysicalMemory'));
        
        if (totalMem && freeMem) {
          const total = parseInt(totalMem.split('=')[1]);
          const free = parseInt(freeMem.split('=')[1]);
          const usedPercent = ((total - free) / total * 100).toFixed(1);
          
          console.log(`💾 Mémoire utilisée: ${usedPercent}%`);
          if (usedPercent > 80) {
            console.log('⚠️  Mémoire élevée - Possible cause de crash');
          }
        }
      }
    });
  } catch (e) {
    console.log('⚠️  Impossible de vérifier la mémoire');
  }
  
  console.log('\n🎯 DIAGNOSTIC FINAL:');
  console.log('==================');
  console.log('Si le problème persiste, les causes possibles sont:');
  console.log('1. Crash du serveur Node.js (memory leak)');
  console.log('2. Erreur JavaScript bloquante dans le navigateur');
  console.log('3. Problème de session utilisateur');
  console.log('4. Conflit de port ou autre processus');
}

async function createTestLogs(connection) {
  const testLogs = [
    ['INFO', 'system', 'monitoring', 'Platform stability check'],
    ['INFO', 'system', 'monitoring', 'Database connection verified'],
    ['WARNING', 'system', 'monitoring', 'System resources monitoring active']
  ];
  
  for (const [level, source, service, message] of testLogs) {
    await connection.execute(`
      INSERT INTO logs (timestamp, log_level, source, service, message, normalized_message, event_type, fingerprint)
      VALUES (NOW(), ?, ?, ?, ?, ?, ?, ?)
    `, [level, source, service, message, message, 'system', 'monitoring_' + Date.now()]);
  }
  
  console.log('✅ Logs de test créés');
}

deepDiagnosis();
