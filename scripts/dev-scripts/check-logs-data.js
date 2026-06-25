import mysql from 'mysql2/promise';
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

async function checkLogsData() {
  let connection;
  try {
    console.log('🔍 Vérification des données de logs...');
    connection = await mysql.createConnection(dbConfig);
    
    // Vérifier le nombre total de logs
    const [totalLogs] = await connection.execute('SELECT COUNT(*) as count FROM logs');
    console.log(`📊 Total logs dans la base: ${totalLogs[0].count}`);
    
    if (totalLogs[0].count === 0) {
      console.log('❌ Aucun log dans la base de données');
      console.log('💡 Solution: Importez des logs via l\'interface d\'importation');
      return;
    }
    
    // Vérifier les dates des logs
    const [dateRange] = await connection.execute(`
      SELECT 
        MIN(timestamp) as oldest,
        MAX(timestamp) as newest,
        COUNT(DISTINCT DATE(timestamp)) as unique_dates
      FROM logs
    `);
    
    console.log(`📅 Période des logs: ${dateRange[0].oldest} → ${dateRange[0].newest}`);
    console.log(`📆 Jours uniques: ${dateRange[0].unique_dates}`);
    
    // Vérifier les niveaux de logs
    const [levels] = await connection.execute(`
      SELECT log_level, COUNT(*) as count 
      FROM logs 
      GROUP BY log_level 
      ORDER BY count DESC
    `);
    
    console.log('\n📈 Répartition par niveau:');
    levels.forEach(level => {
      console.log(`  ${level.log_level}: ${level.count}`);
    });
    
    // Vérifier les logs des 7 derniers jours
    const [recentLogs] = await connection.execute(`
      SELECT COUNT(*) as count 
      FROM logs 
      WHERE timestamp >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
    `);
    
    console.log(`\n🕐 Logs des 7 derniers jours: ${recentLogs[0].count}`);
    
    // Vérifier les alertes
    const [alertCount] = await connection.execute('SELECT COUNT(*) as count FROM alerts');
    console.log(`🚨 Total alertes: ${alertCount[0].count}`);
    
    // Vérifier les règles d'alerte
    const [alertRules] = await connection.execute('SELECT COUNT(*) as count, is_active FROM alert_rules GROUP BY is_active');
    console.log('\n⚙️  Règles d\'alerte:');
    alertRules.forEach(rule => {
      console.log(`  ${rule.is_active ? 'Actives' : 'Inactives'}: ${rule.count}`);
    });
    
    // Vérifier les jobs d'importation
    const [importJobs] = await connection.execute(`
      SELECT status, COUNT(*) as count 
      FROM import_jobs 
      GROUP BY status
    `);
    
    console.log('\n📦 Jobs d\'importation:');
    importJobs.forEach(job => {
      console.log(`  ${job.status}: ${job.count}`);
    });
    
  } catch (error) {
    console.error('❌ Erreur:', error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

checkLogsData();
