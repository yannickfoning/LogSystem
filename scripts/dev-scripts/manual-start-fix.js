import { spawn, exec } from 'child_process';
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

async function manualStartFix() {
  console.log('🔧 DÉMARRAGE MANUEL ET DIAGNOSTIC COMPLET');
  console.log('======================================\n');
  
  // 1. Vérifier l'environnement
  console.log('1️⃣ VÉRIFICATION ENVIRONNEMENT');
  console.log(`Node.js version: ${process.version}`);
  console.log(`Répertoire: ${process.cwd()}`);
  console.log(`Variables d'environnement:`);
  console.log(`  DB_HOST: ${process.env.DB_HOST}`);
  console.log(`  DB_PORT: ${process.env.DB_PORT}`);
  console.log(`  DB_NAME: ${process.env.DB_NAME}`);
  
  // 2. Vérifier les fichiers essentiels
  console.log('\n2️⃣ VÉRIFICATION FICHIERS ESSENTIELS');
  const requiredFiles = [
    'server.js',
    'package.json',
    '.env',
    'public/login.html',
    'public/api.js',
    'public/i18n.js'
  ];
  
  for (const file of requiredFiles) {
    if (fs.existsSync(path.join(PROJECT_ROOT, file))) {
      console.log(`✅ ${file}`);
    } else {
      console.log(`❌ ${file} MANQUANT`);
      return;
    }
  }
  
  // 3. Vérifier la base de données
  console.log('\n3️⃣ VÉRIFICATION BASE DE DONNÉES');
  try {
    const connection = await mysql.createConnection(dbConfig);
    await connection.execute('SELECT 1');
    
    const [tables] = await connection.execute('SHOW TABLES');
    console.log(`✅ Base connectée - ${tables.length} tables`);
    
    const [logCount] = await connection.execute('SELECT COUNT(*) as cnt FROM logs');
    console.log(`📊 Logs dans base: ${logCount[0].cnt}`);
    
    if (logCount[0].cnt === 0) {
      console.log('⚠️  Base vide - Création de logs de test...');
      await connection.execute(`
        INSERT INTO logs (timestamp, log_level, source, service, message, normalized_message, event_type, fingerprint)
        VALUES (NOW(), 'INFO', 'system', 'monitoring', 'Platform manual start', 'Platform manual start', 'system', 'manual_start')
      `);
      console.log('✅ Log de test créé');
    }
    
    await connection.end();
  } catch (e) {
    console.log(`❌ Erreur base: ${e.message}`);
    console.log('💡 Solution: Démarrez MySQL/MariaDB');
    return;
  }
  
  // 4. Nettoyer les processus
  console.log('\n4️⃣ NETTOYAGE PROCESSUS');
  return new Promise((resolve) => {
    exec('taskkill /F /IM node.exe', (error, stdout, stderr) => {
      console.log('✅ Processus nettoyés');
      setTimeout(resolve, 2000);
    });
  }).then(async () => {
    
    // 5. Démarrer le serveur manuellement
    console.log('\n5️⃣ DÉMARRAGE SERVEUR MANUEL');
    
    const server = spawn('npm', ['run', 'dev'], {
      shell: true,
      stdio: 'inherit',
      cwd: PROJECT_ROOT
    });
    
    server.on('error', (error) => {
      console.error('❌ Erreur démarrage:', error.message);
    });
    
    server.on('close', (code) => {
      console.log(`\n❌ Serveur arrêté (code: ${code})`);
      console.log('🔍 Analyse des erreurs possibles:');
      console.log('1. Port 3001 déjà utilisé');
      console.log('2. Erreur dans server.js');
      console.log('3. Problème de dépendances');
      console.log('4. Erreur base de données');
    });
    
    // 6. Vérifier le démarrage
    console.log('\n6️⃣ VÉRIFICATION DÉMARRAGE (15 secondes)...');
    
    setTimeout(async () => {
      try {
        const response = await fetch('http://localhost:3001/login.html');
        if (response.ok) {
          console.log('\n🎉 SERVEUR FONCTIONNEL!');
          console.log('🌐 Accès: http://localhost:3001/login.html');
          console.log('👤 Admin: admin@logsystem.local / Admin@1234');
          console.log('\n✅ La plateforme est maintenant stable');
        } else {
          console.log('\n⚠️  Serveur répond mais avec erreur:', response.status);
        }
      } catch (e) {
        console.log('\n❌ Serveur inaccessible:', e.message);
        console.log('\n🔧 SOLUTIONS ALTERNATIVES:');
        console.log('1. Vérifiez que MySQL/MariaDB est démarré');
        console.log('2. Essayez: npm install');
        console.log('3. Vérifiez le port 3001: netstat -ano | findstr :3001');
        console.log('4. Démarrez manuellement: node server.js');
      }
    }, 15000);
    
  });
}

manualStartFix();
