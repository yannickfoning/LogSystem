import mysql from 'mysql2/promise';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'logsystem_v4',
  multipleStatements: true
};

async function diagnosePlatformIssues() {
  let connection;
  try {
    console.log('🔍 DIAGNOSTIC COMPLET DE LA PLATEFORME');
    console.log('=====================================\n');
    
    connection = await mysql.createConnection(dbConfig);
    
    // 1. Vérifier la connexion à la base de données
    console.log('1️⃣ CONNEXION BASE DE DONNÉES');
    try {
      await connection.execute('SELECT 1');
      console.log('✅ Base de données accessible');
    } catch (e) {
      console.log('❌ Erreur base de données:', e.message);
      return;
    }
    
    // 2. Vérifier l'espace disque
    console.log('\n2️⃣ ESPACE DISQUE');
    try {
      const stats = fs.statSync('.');
      console.log('✅ Accès au système de fichiers OK');
    } catch (e) {
      console.log('❌ Erreur système de fichiers:', e.message);
    }
    
    // 3. Vérifier les erreurs récentes dans les logs
    console.log('\n3️⃣ ERREURS RÉCENTES');
    const [recentErrors] = await connection.execute(`
      SELECT COUNT(*) as count, 
             MAX(timestamp) as latest
      FROM logs 
      WHERE log_level IN ('ERROR', 'FATAL') 
      AND timestamp >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
    `);
    
    if (recentErrors[0].count > 0) {
      console.log(`⚠️  ${recentErrors[0].count} erreurs critiques détectées`);
      console.log(`📅 Dernière erreur: ${recentErrors[0].latest}`);
    } else {
      console.log('✅ Aucune erreur critique récente');
    }
    
    // 4. Vérifier la charge mémoire
    console.log('\n4️⃣ CHARGE SYSTÈME');
    const [memoryUsage] = await connection.execute(`
      SELECT COUNT(*) as total_logs,
             COUNT(DISTINCT DATE(timestamp)) as days_of_data
      FROM logs
    `);
    
    console.log(`📊 Logs totaux: ${memoryUsage[0].total_logs.toLocaleString()}`);
    console.log(`📆 Jours de données: ${memoryUsage[0].days_of_data}`);
    
    if (memoryUsage[0].total_logs > 100000) {
      console.log('⚠️  Volume de logs élevé - peut causer des problèmes de performance');
    }
    
    // 5. Vérifier les sessions actives
    console.log('\n5️⃣ SESSIONS UTILISATEURS');
    // Note: Cette vérification dépend de votre système de sessions
    
    // 6. Vérifier les jobs d'importation récents
    console.log('\n6️⃣ IMPORTATIONS RÉCENTES');
    const [recentImports] = await connection.execute(`
      SELECT status, COUNT(*) as count
      FROM import_jobs 
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
      GROUP BY status
    `);
    
    if (recentImports.length > 0) {
      console.log('📦 Jobs d\'importation récents:');
      recentImports.forEach(job => {
        console.log(`  ${job.status}: ${job.count}`);
      });
    } else {
      console.log('✅ Aucune importation récente');
    }
    
    // 7. Vérifier les alertes actives
    console.log('\n7️⃣ ALERTES ACTIVES');
    const [activeAlerts] = await connection.execute(`
      SELECT COUNT(*) as count,
             MAX(created_at) as latest
      FROM alerts 
      WHERE status = 'new'
    `);
    
    if (activeAlerts[0].count > 0) {
      console.log(`🚨 ${activeAlerts[0].count} alertes non lues`);
      console.log(`📅 Dernière alerte: ${activeAlerts[0].latest}`);
    } else {
      console.log('✅ Aucune alerte en attente');
    }
    
    console.log('\n🎯 CAUSES POSSIBLES DE FERMETURE:');
    console.log('================================');
    console.log('1. Erreur JavaScript dans le navigateur');
    console.log('2. Crash du serveur Node.js');
    console.log('3. Perte de connexion base de données');
    console.log('4. Memory leak (fuite mémoire)');
    console.log('5. Trop de logs en mémoire');
    console.log('6. Erreur dans un job d\'importation');
    console.log('7. Problème de session utilisateur');
    
  } catch (error) {
    console.error('❌ Erreur diagnostic:', error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

diagnosePlatformIssues();
