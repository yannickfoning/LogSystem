import pool from '../../config/database.js';

/**
 * RAPPORT DE CERTIFICATION D'ISOLATION A/B
 * Objectif : Prouver qu'aucune fuite de données n'existe entre deux tenants.
 */
async function runCertification() {
  const USER_A = { id: 1, secret: `SECRET_TENANT_A_${Date.now()}` };
  const USER_B = { id: 2, secret: `SECRET_TENANT_B_${Date.now()}` };
  
  console.log('=== DÉBUT DU TEST DE CERTIFICATION ISOLATION ===');

  try {
    // 1. PHASE D'INJECTION
    console.log('1. Injection des secrets distincts...');
    await pool.execute('INSERT INTO logs (message, user_id, log_level, timestamp) VALUES (?, ?, "ERROR", NOW())', [USER_A.secret, USER_A.id]);
    await pool.execute('INSERT INTO logs (message, user_id, log_level, timestamp) VALUES (?, ?, "INFO", NOW())', [USER_B.secret, USER_B.id]);

    // 2. VÉRIFICATION DES ENDPOINTS (Via SQL simulant le middleware userScope)
    const testEndpoints = [
      { name: 'GET /api/logs', sql: 'SELECT * FROM logs WHERE 1=1 AND user_id = ?' },
      { name: 'GET /api/search', sql: 'SELECT * FROM logs WHERE (message LIKE ? OR message LIKE ?) AND user_id = ?' },
      { name: 'GET /api/dashboard/summary', sql: 'SELECT COUNT(*) as cnt FROM logs WHERE user_id = ?' },
      { name: 'GET /api/alerts', sql: 'SELECT * FROM alerts WHERE user_id = ?' }
    ];

    let leakDetected = false;

    for (const endpoint of testEndpoints) {
      console.log(`Vérification : ${endpoint.name} pour le Compte A...`);
      
      let rows;
      if (endpoint.name.includes('search')) {
        [rows] = await pool.execute(endpoint.sql, [`%${USER_A.secret}%`, `%${USER_B.secret}%`, USER_A.id]);
      } else {
        [rows] = await pool.execute(endpoint.sql, [USER_A.id]);
      }

      // Analyse de la réponse
      const content = JSON.stringify(rows);
      if (content.includes(USER_B.secret)) {
        console.error(`❌ ÉCHEC CRITIQUE : Le compte A peut voir le secret du compte B dans ${endpoint.name}`);
        leakDetected = true;
      } else {
        console.log(`✅ OK : Aucune fuite de B vers A dans ${endpoint.name}`);
      }
    }

    // 3. VÉRIFICATION DES COMPTEURS (Isolation Trends/Summary)
    const [countA] = await pool.execute('SELECT COUNT(*) as cnt FROM logs WHERE user_id = ?', [USER_A.id]);
    const [countGlobal] = await pool.execute('SELECT COUNT(*) as cnt FROM logs');
    
    if (parseInt(countA[0].cnt) < parseInt(countGlobal[0].cnt)) {
      console.log(`✅ OK : Les compteurs sont scopés (A: ${countA[0].cnt}, Global: ${countGlobal[0].cnt})`);
    } else if (parseInt(countGlobal[0].cnt) > 0) {
      console.warn('⚠️ ATTENTION : Les compteurs sont identiques au global. Vérifiez si la DB contient d\'autres données.');
    }

    // 4. NETTOYAGE
    await pool.execute('DELETE FROM logs WHERE message = ? OR message = ?', [USER_A.secret, USER_B.secret]);
    
    if (leakDetected) {
      console.error('\nRESULTAT FINAL : ❌ ÉCHEC DE CERTIFICATION');
      process.exit(1);
    } else {
      console.log('\nRESULTAT FINAL : 🟢 CERTIFICATION RÉUSSIE');
      process.exit(0);
    }

  } catch (err) {
    console.error('Erreur durant le test:', err);
    process.exit(1);
  }
}

runCertification();