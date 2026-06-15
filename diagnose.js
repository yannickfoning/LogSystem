import pool from './config/database.js';

/**
 * SCRIPT DE DIAGNOSTIC DES DONNÉES DU DASHBOARD
 * Version 1.0 - Vérification imported_at vs timestamp
 */
async function runDiagnostic() {
  console.log('=== LOGSYSTEM : DIAGNOSTIC DES DONNÉES ===\n');

  try {
    // 1. Vérification de la connexion
    await pool.execute('SELECT 1');
    console.log('✅ Connexion base de données : OK');

    // 2. Analyse globale des volumes
    const [total] = await pool.execute('SELECT COUNT(*) as cnt FROM logs');
    console.log(`📊 Total des logs en base : ${total[0].cnt}`);

    // 3. Analyse de la temporalité (Cause 1)
    const todayStr = new Date().toISOString().slice(0, 10);
    const [ingestedToday] = await pool.execute(
      'SELECT COUNT(*) as cnt FROM logs WHERE imported_at >= ?',
      [todayStr + ' 00:00:00']
    );
    console.log(`📊 Logs ingérés aujourd'hui (imported_at) : ${ingestedToday[0].cnt}`);

    const [minMax] = await pool.execute(
      'SELECT MIN(timestamp) as oldest, MAX(timestamp) as newest FROM logs'
    );
    console.log(`📅 Plage des timestamps réels : du ${minMax[0].oldest} au ${minMax[0].newest}`);

    const [last7Days] = await pool.execute(
      'SELECT COUNT(*) as cnt FROM logs WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 7 DAY)'
    );
    console.log(`📅 Logs dans la fenêtre des 7 derniers jours (timestamp) : ${last7Days[0].cnt}`);

    // 4. Vérification du format Admin (Cause 2)
    // On simule la requête de recent-logs
    const [recentRows] = await pool.execute('SELECT id, timestamp, log_level, message FROM logs ORDER BY id DESC LIMIT 5');
    console.log(`\n🔍 Requête logs récents (Admin) : ${recentRows.length} résultats trouvés.`);
    if (recentRows.length > 0) {
      console.log('   Exemple de structure :', recentRows[0]);
    }

    console.log('\n=== CONSEIL DE FIX ===');
    if (ingestedToday[0].cnt > 0 && last7Days[0].cnt === 0) {
      console.log('👉 Les données sont présentes mais leurs TIMESTAMPS sont hors fenêtre (trop vieux ou futurs).');
      console.log('👉 Action : Dans dashboard.js, modifiez les requêtes TRENDS pour filtrer sur "timestamp" si vous voulez voir l\'historique réel.');
    }

  } catch (err) {
    console.error('\n❌ Échec du diagnostic :', err.message);
  } finally {
    await pool.end();
  }
}

runDiagnostic();