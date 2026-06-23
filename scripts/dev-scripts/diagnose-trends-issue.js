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

async function diagnoseTrendsIssue() {
  let connection;
  try {
    console.log('🔍 DIAGNOSTIC RAPIDE DES TENDANCES');
    console.log('=====================================\n');
    
    connection = await mysql.createConnection(dbConfig);
    
    // Cause 1: Vérifier si la base est vide
    console.log('1️⃣ VÉRIFICATION BASE DE DONNÉES VIDIE');
    const [totalLogs] = await connection.execute('SELECT COUNT(*) as count FROM logs');
    console.log(`📊 Total logs dans la base: ${totalLogs[0].count}`);
    
    if (totalLogs[0].count === 0) {
      console.log('❌ CAUSE 1 DÉTECTÉE: Base de données vide');
      console.log('💡 Solution: Importez des logs via la page Import');
      return;
    }
    
    // Cause 3: Vérifier les dates des logs
    console.log('\n2️⃣ VÉRIFICATION DATES DES LOGS');
    const [dateRange] = await connection.execute(`
      SELECT 
        MIN(timestamp) as oldest,
        MAX(timestamp) as newest,
        COUNT(*) as total
      FROM logs
    `);
    
    console.log(`📅 Période des logs: ${dateRange[0].oldest} → ${dateRange[0].newest}`);
    
    // Vérifier les logs des 7 derniers jours
    const [recentLogs] = await connection.execute(`
      SELECT COUNT(*) as count 
      FROM logs 
      WHERE timestamp >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
    `);
    
    console.log(`🕐 Logs des 7 derniers jours: ${recentLogs[0].count}`);
    
    if (recentLogs[0].count === 0) {
      console.log('❌ CAUSE 3 DÉTECTÉE: Logs trop anciens');
      console.log('💡 Solution: Importez des logs récents ou modifiez la période');
    }
    
    // Vérifier la répartition par niveau
    console.log('\n3️⃣ VÉRIFICATION RÉPARTITION PAR NIVEAU');
    const [levels] = await connection.execute(`
      SELECT log_level, COUNT(*) as count 
      FROM logs 
      GROUP BY log_level 
      ORDER BY count DESC
    `);
    
    console.log('📈 Répartition par niveau:');
    levels.forEach(level => {
      console.log(`  ${level.log_level}: ${level.count}`);
    });
    
    // Vérifier les fichiers corrigés
    console.log('\n4️⃣ VÉRIFICATION FICHIERS CORRIGÉS');
    try {
      const dashboardJs = fs.readFileSync(path.join(PROJECT_ROOT, 'routes', 'dashboard.js'), 'utf8');
      if (dashboardJs.includes('DATE_FORMAT(timestamp, \'%Y-%m-%d\')')) {
        console.log('✅ routes/dashboard.js: Contient le code corrigé');
      } else {
        console.log('❌ routes/dashboard.js: Ancienne version détectée');
        console.log('💡 Solution: Remplacez par le fichier corrigé');
      }
    } catch (e) {
      console.log('❌ routes/dashboard.js: Fichier non trouvé');
    }
    
    try {
      const dashboardHtml = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'dashboard.html'), 'utf8');
      if (dashboardHtml.includes('trends-chart')) {
        console.log('✅ public/dashboard.html: Contient le graphique');
      } else {
        console.log('❌ public/dashboard.html: Graphique non trouvé');
      }
    } catch (e) {
      console.log('❌ public/dashboard.html: Fichier non trouvé');
    }
    
    // Test de l'API trends
    console.log('\n5️⃣ TEST API TRENDS');
    try {
      const response = await fetch('http://localhost:3001/api/dashboard/trends');
      if (response.ok) {
        const data = await response.json();
        console.log('✅ API trends répond correctement');
        console.log(`📊 Dates retournées: ${data.dates?.length || 0}`);
        console.log(`📈 Séries retournées: ${Object.keys(data.series || {}).length}`);
      } else {
        console.log(`❌ API trends erreur: ${response.status}`);
      }
    } catch (e) {
      console.log('❌ API trends inaccessible:', e.message);
      console.log('💡 Solution: Démarrez le serveur');
    }
    
    console.log('\n🎯 DIAGNOSTIC TERMINÉ');
    console.log('==================');
    
    if (totalLogs[0].count > 0 && recentLogs[0].count > 0) {
      console.log('✅ Les données semblent correctes');
      console.log('🔍 Vérifiez la console F12 pour les erreurs JavaScript');
    }
    
  } catch (error) {
    console.error('❌ Erreur diagnostic:', error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

diagnoseTrendsIssue();
