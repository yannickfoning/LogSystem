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

async function createAlertRules() {
  let connection;
  try {
    console.log('🔧 Création des règles d\'alerte...');
    connection = await mysql.createConnection(dbConfig);
    
    // Règles d'alerte par défaut (adaptées à la structure de la table)
    const alertRules = [
      {
        name: 'Erreur critique',
        description: 'Alerte sur les erreurs critiques',
        condition_type: 'level',
        condition_value: 'error',
        threshold_value: 1,
        time_window_minutes: 5,
        severity: 'critical',
        is_active: 1,
        created_by: 1
      },
      {
        name: 'Pic d\'erreurs',
        description: 'Alerte sur les pics d\'erreurs',
        condition_type: 'count',
        condition_value: 'error',
        threshold_value: 10,
        time_window_minutes: 1,
        severity: 'high',
        is_active: 1,
        created_by: 1
      },
      {
        name: 'Aucune activité',
        description: 'Alerte si aucune activité détectée',
        condition_type: 'count',
        condition_value: 'info',
        threshold_value: 0,
        time_window_minutes: 60,
        severity: 'medium',
        is_active: 1,
        created_by: 1
      },
      {
        name: 'Volume élevé de logs',
        description: 'Alerte sur volume élevé de logs',
        condition_type: 'count',
        condition_value: 'info',
        threshold_value: 1000,
        time_window_minutes: 5,
        severity: 'medium',
        is_active: 1,
        created_by: 1
      },
      {
        name: 'Logs WARNING',
        description: 'Alerte sur les logs de niveau WARNING',
        condition_type: 'level',
        condition_value: 'warning',
        threshold_value: 5,
        time_window_minutes: 5,
        severity: 'medium',
        is_active: 1,
        created_by: 1
      }
    ];
    
    // Insérer les règles
    for (const rule of alertRules) {
      await connection.execute(`
        INSERT INTO alert_rules (name, description, condition_type, condition_value, threshold_value, time_window_minutes, severity, is_active, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `, [
        rule.name,
        rule.description,
        rule.condition_type,
        rule.condition_value,
        rule.threshold_value,
        rule.time_window_minutes,
        rule.severity,
        rule.is_active,
        rule.created_by
      ]);
      console.log(`✅ Règle créée: ${rule.name}`);
    }
    
    // Vérifier les règles créées
    const [rules] = await connection.execute('SELECT name, severity, is_active FROM alert_rules');
    console.log('\n📋 Règles d\'alerte créées:');
    rules.forEach(rule => {
      console.log(`  ${rule.name} (${rule.severity}) - ${rule.is_active ? 'Active' : 'Inactive'}`);
    });
    
    console.log('\n🎯 Les alertes en temps réel devraient maintenant fonctionner!');
    console.log('📈 Les tendances devraient aussi afficher les données correctement.');
    
  } catch (error) {
    console.error('❌ Erreur:', error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

createAlertRules();
