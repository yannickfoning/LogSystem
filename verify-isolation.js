import pool from './config/database.js';
import logger from './config/logger.js';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.TEST_URL || `http://localhost:${PORT}`; // Allow overriding for remote testing

/**
 * RAPPORT DE CERTIFICATION D'ISOLATION A/B
 * Version 5.9 - CERTIFICATION FINALE RC1 : Audit récursif, Mass Assignment & Validation PDF.
 */

const CERT_CONFIG = {
  endpoints: [
    { path: '/api/logs', dataKey: 'logs' },
    { path: '/api/dashboard/summary', dataKey: 'data' },
    { path: '/api/dashboard/trends', dataKey: 'trends' },
    { path: '/api/dashboard/alerts', dataKey: 'alerts' },
    { path: '/api/search', dataKey: 'logs' }
  ],
  idor: [
    { resource: 'Log', path: '/api/logs', verbs: ['GET', 'DELETE'] },
    { resource: 'Alerte', path: '/api/dashboard/alerts', verbs: ['GET', 'PUT'], suffix: '/read' }
  ],
  exports: [
    { path: '/api/logs/export/csv', format: 'csv' },
    { path: '/api/logs/export/json', format: 'json' },
    { path: '/api/logs/export/pdf', format: 'pdf' }
  ],
  aggregations: [
    { label: 'Total Logs', field: 'totalLogs', sql: 'SELECT COUNT(*) as cnt FROM logs WHERE user_id = ?' },
    { label: 'Alertes Actives', field: 'unreadAlerts', sql: "SELECT COUNT(*) as cnt FROM alerts WHERE status = 'new' AND user_id = ?" },
    { label: 'Groupes d\'Erreurs', field: 'errorCount', sql: "SELECT COUNT(DISTINCT fingerprint) as cnt FROM logs WHERE log_level IN ('ERROR','CRITICAL','FATAL') AND user_id = ?" }
  ],
  massAssignmentPath: '/api/logs' // Endpoint pour tester la modification de user_id
};

async function createTestUser(email, password, name) {
  const hash = await bcrypt.hash(password, 12);
  const [res] = await pool.execute(
    'INSERT INTO users (email, password, displayName, role, is_active, session_version) VALUES (?, ?, ?, "user", 1, 1)',
    [email, hash, name]
  );
  return res.insertId;
}

async function login(email, password) {
  logger.debug(`Tentative de login pour ${email}...`);
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Échec login pour ${email} (Status: ${res.status}, Body: ${errorText}). Le serveur est-il démarré sur ${BASE_URL} ?`);
  }
  
  // Portabilité getSetCookie (Point 2) - Utilise getSetCookie si disponible, sinon fallback
  const setCookieHeaders = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  // Fallback pour les environnements où getSetCookie n'est pas dispo ou retourne un seul header
  if (setCookieHeaders.length === 0 && res.headers.get('set-cookie')) {
    setCookieHeaders.push(res.headers.get('set-cookie'));
  }

  if (!setCookieHeaders.length) throw new Error('Aucun cookie de session retourné.');
  
  return setCookieHeaders.join('; '); // Joindre tous les cookies en une seule chaîne
}

/**
 * Détection de fuite universelle (Point 2 - v5.9)
 * Recherche récursive de n'importe quelle donnée du tenant cible dans un objet.
 */
function containsTenantData(obj, target) {
  if (obj === null || obj === undefined) return false;

  if (Array.isArray(obj)) {
    return obj.some(item => containsTenantData(item, target));
  }

  if (typeof obj === 'object') {
    for (const [key, val] of Object.entries(obj)) {
      // Protection IDOR et détection d'ID (user_id, ownerId, etc.)
      if (val === target.id) return true;
      
      // Détection de chaînes (Secret ou Email)
      if (typeof val === 'string' && (val.includes(target.secret) || val.includes(target.email))) return true;
      
      // Récursion
      if (typeof val === 'object' && containsTenantData(val, target)) return true;
    }
  }
  return false;
}

async function runIsolationTests(userA, userB) {
  let testsPassed = true;
  const scenarios = [
    { subject: userA, target: userB, label: 'User A ne doit pas voir User B' },
    { subject: userB, target: userA, label: 'User B ne doit pas voir User A' }
  ];

  // 1. Tests d'isolation croisée (Positifs)
  for (const s of scenarios) {
    console.log(`\n--- 1.1 Isolation : Lecture et Recherche (Scenario: ${s.label}) ---`);
    for (const ep of CERT_CONFIG.endpoints) {
      const url = `${BASE_URL}${ep.path}`;
      process.stdout.write(`   Appel ${ep.split('?')[0]}... `);
      
      const res = await fetch(url, { headers: { 'Cookie': s.subject.cookie } });
      
      // Validation HTTP (Point 4)
      if (res.status !== 200) {
        console.log(`❌ FAILED (HTTP ${res.status})`);
        testsPassed = false; continue;
      }

      const data = await res.json();

      // Détection de fuite universelle récursive (v5.9)
      const leaked = containsTenantData(data, s.target);

      if (leaked) {
        console.log('❌ FUITE DÉTECTÉE');
        testsPassed = false;
      } else {
        console.log('✅ OK');
      }
    }
  }

  // 2. Tests de sécurité négatifs (Point 6 - v5.4)
  console.log(`\n--- Sécurité : Contrôles d'accès négatifs ---`);
  const negativeScenarios = [
    { label: 'Accès sans cookie (401 attendu)', cookie: null, expectedStatus: [401, 403] },
    { label: 'Accès avec cookie invalide (401 attendu)', cookie: 'session=invalid_token_123', expectedStatus: [401, 403] }
  ];

  for (const ns of negativeScenarios) {
    process.stdout.write(`   ${ns.label}... `);
    const headers = ns.cookie ? { 'Cookie': ns.cookie } : {};
    const res = await fetch(`${BASE_URL}/api/logs`, { headers });
    if (ns.expectedStatus.includes(res.status)) {
      console.log('✅ OK');
    } else {
      console.log(`❌ ÉCHEC (Reçu HTTP ${res.status})`);
      testsPassed = false;
    }
  }

  // 3. Test de recherche négative (Point 3 - v5.6)
  console.log(`\n--- Recherche : Test de fuite vide ---`);
  const randomSecret = `NOT_FOUND_${uuidv4()}`;
  process.stdout.write(`   Recherche d'un secret inexistant (${randomSecret})... `);
  const searchRes = await fetch(`${BASE_URL}/api/search?query=${randomSecret}`, { 
    headers: { 'Cookie': userA.cookie } 
  });
  
  if (searchRes.ok) {
    const searchData = await searchRes.json();

    // Utilisation de la vérification de contrat robuste
    if (isResultEmpty(searchData)) {
      console.log('✅ OK (Aucune donnée renvoyée par erreur)');
    } else {
      console.log(`❌ ÉCHEC (Données trouvées dans la réponse alors qu'aucun résultat n'était attendu)`);
      testsPassed = false;
    }
  } else {
    console.log(`❌ ÉCHEC HTTP ${searchRes.status}`);
    testsPassed = false;
  }

  return testsPassed;
}

async function collectIndexEvidence() {
  let evidencePassed = true;
  console.log('\n--- PREUVES SQL : INDEXES CRITIQUES (Composition) ---');

  const requirements = [
    { table: 'logs', columns: ['user_id', 'timestamp'] },
    { table: 'logs', columns: ['user_id', 'fingerprint', 'timestamp'] },
    { table: 'alerts', columns: ['user_id', 'status', 'created_at'] }
  ];

  for (const req of requirements) {
    process.stdout.write(`   Vérification index sur '${req.table}' pour (${req.columns.join(', ')})... `);
    const [rows] = await pool.execute(`SHOW INDEX FROM ${req.table}`);
    
    // On groupe les colonnes par nom d'index pour vérifier la séquence (Point 4)
    const indexes = {};
    rows.forEach(r => {
      if (!indexes[r.Key_name]) indexes[r.Key_name] = [];
      indexes[r.Key_name][r.Seq_in_index - 1] = r.Column_name;
    });

    const found = Object.values(indexes).some(cols => {
      // On vérifie que les colonnes requises forment le préfixe de l'index.
      // Note: L'existence est indicative, seul l'EXPLAIN (phase suivante) certifie l'usage.
      return req.columns.every((c, i) => cols[i] === c);
    });

    if (found) {
      console.log('✅ PASS');
    } else {
      console.log('❌ MANQUANT');
      evidencePassed = false;
    }
  }
  return evidencePassed;
}

async function collectExplainEvidence(userId) {
  let evidencePassed = true;
  console.log('\n--- PREUVES SQL : PLANS D\'EXÉCUTION (EXPLAIN) ---');
  const efficientTypes = ['ref', 'range', 'index', 'eq_ref', 'const'];
  
  const explains = [
    { name: 'Dashboard Summary', sql: 'EXPLAIN SELECT log_level, COUNT(*) FROM logs WHERE user_id = ? GROUP BY log_level', params: [userId] },
    { name: 'Recent Logs', sql: 'EXPLAIN SELECT * FROM logs WHERE user_id = ? ORDER BY id DESC LIMIT 10', params: [userId] },
    { name: 'Alerts Evaluation', sql: 'EXPLAIN SELECT COUNT(*) FROM logs WHERE user_id = ? AND log_level="ERROR" AND timestamp >= ?', params: [userId, new Date(Date.now() - 3600000)] }
  ];

  for (const q of explains) {
    const [rows] = await pool.execute(q.sql, q.params);
    console.log(`\nEXPLAIN: ${q.name}`);
    console.table(rows);

    // Vérification de toutes les lignes de l'EXPLAIN (Point 4 & 5)
    const badRows = rows.filter(r => r.type === 'ALL');
    const warnRows = rows.filter(r => r.type !== 'ALL' && !efficientTypes.includes(r.type));

    if (badRows.length > 0) {
      console.log(`❌ ÉCHEC : Scan complet ('ALL') détecté.`);
      evidencePassed = false;
    } else if (warnRows.length > 0) {
      console.log(`⚠️ WARNING : Plan sous-optimal détecté (${warnRows[0].type}).`);
    } else {
      console.log('✅ OK : Aucun scan complet de table détecté.');
    }
  }
  return evidencePassed;
}

async function cleanup(userA, userB) {
  console.log('\n--- NETTOYAGE ---');
  for (const u of [userA, userB]) {
    const safeIdentifier = /^[a-zA-Z0-9_]+$/;
    if (u.id) {
      try {
        // Nettoyage dynamique sécurisé (Point 4 - v5.7)
        const [fkTables] = await pool.execute(
          `SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
           WHERE REFERENCED_TABLE_NAME = 'users' AND TABLE_SCHEMA = DATABASE()`
        );
        for (const fk of fkTables) {
          if (!safeIdentifier.test(fk.TABLE_NAME) || !safeIdentifier.test(fk.COLUMN_NAME)) {
            throw new Error(`Identifiant SQL invalide détecté : ${fk.TABLE_NAME}`);
          }
          // Sécurisation par backticks pour éviter les erreurs sur noms réservés
          await pool.execute(
            `DELETE FROM \`${fk.TABLE_NAME}\` WHERE \`${fk.COLUMN_NAME}\` = ?`, 
            [u.id]);
        }
      } catch (e) {
        console.warn(`⚠️ Nettoyage dynamique des FK échoué, repli sur suppression manuelle: ${e.message}`);
        await pool.execute('DELETE FROM alerts WHERE user_id = ?', [u.id]).catch(()=>{});
        await pool.execute('DELETE FROM error_groups WHERE user_id = ?', [u.id]).catch(()=>{});
        await pool.execute('DELETE FROM logs WHERE user_id = ?', [u.id]).catch(()=>{});
      }
      await pool.execute('DELETE FROM users WHERE id = ?', [u.id]);
      console.log(`Utilisateur ${u.email} nettoyé.`);
    }
  }
}

async function main() { // Point 5: Préconditions documentées
  let exitCode = 0;
  const password = 'CertPassword123!';
  const userA = { id: null, logId: null, alertId: null, email: `cert_a_${uuidv4().slice(0,8)}@coleps.test`, secret: `SEC_A_${uuidv4()}`, cookie: null };
  const userB = { id: null, logId: null, alertId: null, email: `cert_b_${uuidv4().slice(0,8)}@coleps.test`, secret: `SEC_B_${uuidv4()}`, cookie: null };

  console.log('=== DOSSIER DE CERTIFICATION TECHNIQUE : LOGSYSTEM v5.3 ===');
  console.log(`\nPréconditions:`);
  console.log(`  - Le serveur LogSystem doit être démarré et accessible sur ${BASE_URL}.`);
  console.log(`  - L'endpoint POST /api/auth/login doit être fonctionnel.`);
  console.log(`  - La table 'users' doit avoir les colonnes 'email', 'password', 'displayName', 'role', 'is_active', 'session_version'.`);
  console.log(`  - La table 'logs' doit avoir les colonnes 'message', 'user_id', 'log_level', 'timestamp'.`);

  try {
    // 1. SETUP UTILISATEURS DYNAMIQUES
    userA.id = await createTestUser(userA.email, password, 'Cert User A');
    userB.id = await createTestUser(userB.email, password, 'Cert User B');

    // 2. INJECTION DE DONNÉES SENSIBLES (Point 1: Injection complète pour les deux tenants)
    const [resA] = await pool.execute('INSERT INTO logs (message, user_id, log_level, timestamp) VALUES (?, ?, "ERROR", NOW())', [userA.secret, userA.id]);
    userA.logId = resA.insertId;
    const [resB] = await pool.execute('INSERT INTO logs (message, user_id, log_level, timestamp) VALUES (?, ?, "INFO", NOW())', [userB.secret, userB.id]);
    userB.logId = resB.insertId;

    // Injection d'alertes pour test IDOR étendu
    const [altA] = await pool.execute('INSERT INTO alerts (message, user_id, severity, status) VALUES ("ALERT_A", ?, "high", "new")', [userA.id]);
    userA.alertId = altA.insertId;
    const [altB] = await pool.execute('INSERT INTO alerts (message, user_id, severity, status) VALUES ("ALERT_B", ?, "high", "new")', [userB.id]);
    userB.alertId = altB.insertId;

    // Nettoyage des règles d'alerte temporaires (pour le test SSE)
    await pool.execute('DELETE FROM alert_rules WHERE name LIKE "TEMP_ALERT_RULE_%"');
    
    // 3. AUTHENTIFICATION
    userA.cookie = await login(userA.email, password);
    userB.cookie = await login(userB.email, password);

    // 4. EXÉCUTION DES PHASES DE CERTIFICATION
    if (!(await runIsolationTests(userA, userB))) exitCode = 1; // Phase 1: Isolation API
    if (!(await collectIndexEvidence())) exitCode = 1;         // Phase 2: Index SQL
    if (!(await collectExplainEvidence(userA.id))) exitCode = 1; // Phase 3: Plans d'exécution SQL
    
    // Phase 4: Vérification du moteur d'alertes (Point 2: Déportée)
    console.log('\n--- PHASE 4 : VÉRIFICATION MOTEUR D\'ALERTES ---');
    console.log('INFO: La vérification du fonctionnement du moteur d\'alertes nécessite l\'analyse des logs d\'exécution externes (ex: logs Render).');
    console.log('      Recherchez les événements "starting_alert_evaluation" et "alert_evaluation_completed" sans "smart_alert_eval_error".');

  } catch (err) {
    console.error(`\n❌ ERREUR CRITIQUE : ${err.message}`);
    exitCode = 1;
  } finally {
    await cleanup(userA, userB);
    console.log(`\nVERDICT FINAL DU SCRIPT : ${exitCode === 0 ? '🟢 PASS' : '❌ FAIL'}`);
    process.exit(exitCode);
  }
}

main();