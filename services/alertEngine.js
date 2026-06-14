import logger from '../config/logger.js';
import pool from '../config/database.js';
import { levelSeverity } from '../config/database.js';
import { normalizeLevel } from '../config/database.js';
import EventEmitter from 'events';

const ALERT_EVAL_INTERVAL = parseInt(process.env.ALERT_EVAL_INTERVAL || '60000', 10);
const SAFETY_INTERVAL = parseInt(process.env.SAFETY_INTERVAL || ALERT_EVAL_INTERVAL.toString(), 10); // Fix #3: Use ALERT_EVAL_INTERVAL (60s) instead of 10s to prevent DB saturation
const ALERT_DEBOUNCE_MS = parseInt(process.env.ALERT_DEBOUNCE_MS || '2000', 10); // P-06: Debounce 2-5s per userId

let alertWorker = null;
const alertEngineBus = new EventEmitter(); // FIX #5: Bus event-driven
let safetyTimer = null; // Reference pour le cleanup

// P-06: Debounce map for alert evaluation per userId
const debounceTimers = new Map();

function debounceEvalUser(userId) {
  // P-06: Debounce alert evaluation per user to prevent concurrent evaluations
  const key = userId || 'global';
  
  // Clear existing timer
  if (debounceTimers.has(key)) {
    clearTimeout(debounceTimers.get(key));
  }
  
  // Schedule new evaluation
  const timerId = setTimeout(async () => {
    debounceTimers.delete(key);
    try {
      if (userId) {
        await evalAllForUser(userId);
      } else {
        logger.debug('[ALERT] Skipping debounced evaluation for null userId');
      }
    } catch (e) {
      logger.error({ event: 'debounced_eval_error', userId, error: e.message }, '[ALERT]');
    }
  }, ALERT_DEBOUNCE_MS);
  
  debounceTimers.set(key, timerId);
}

export function setAlertWorker(worker) {
  alertWorker = worker;
}

async function ensureDefaultAlertRules() {
  const [rows] = await pool.execute('SELECT COUNT(*) as cnt FROM alert_rules WHERE is_active = 1');
  if (rows[0].cnt > 0) return;

  logger.info({ event: 'seeding_default_alert_rules' }, '[ALERT]');
  // FIX BUG-ALERT-03: Seed rules per-admin only (never NULL created_by)
  const [adminUsers] = await pool.execute("SELECT id FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 5");
  if (!adminUsers.length) { logger.info({ event: 'no_admin_users_seeding_skipped' }, '[ALERT]'); return; }
  // Comprehensive default alert rules (all 12 requirements)
  const allRules = [
    // 5. Alertes critiques — ERROR: 10 erreurs / 5 minutes
    ['Erreurs fréquentes (ERROR)', 'Détecte 10+ erreurs ERROR sur 5 minutes', 'level', 'ERROR', 10, 5, 'high', 10],
    // 5. FATAL: 1 occurrence
    ['FATAL détecté', 'Alerte immédiate sur toute occurrence FATAL', 'level', 'FATAL', 1, 60, 'critical', 5],
    // 5. CRITICAL: 1 occurrence
    ['CRITICAL détecté', 'Alerte immédiate sur toute occurrence CRITICAL', 'level', 'CRITICAL', 1, 60, 'critical', 10],
    // 5. SECURITY: 3 occurrences
    ['Événements sécurité', 'Détecte 3+ événements de sécurité', 'level', 'SECURITY', 3, 30, 'critical', 15],
    // 5. AUTH failures: 5 in window
    ['Échecs authentification', 'Détecte 5+ échecs de connexion sur 10 minutes', 'count', 'auth_fail', 5, 10, 'high', 15],
    // 5. DISK: 80% (monitored via log patterns)
    ['Disque critique (80%)', 'Alerte si logs signalent utilisation disque > 80%', 'fingerprint', 'disk_space_critical', 1, 60, 'critical', 30],
    // Volume anormal
    ['Volume anormal', 'Alerte sur un volume de logs inhabituel (5000/h)', 'count', 'all', 5000, 60, 'medium', 60],
    // Silence ingestion
    ['Silence ingestion', 'Aucune activité détectée depuis 30 minutes', 'silence', 'all', 0, 30, 'medium', 60],
    // ERROR trend (broader window)
    ['Erreurs critiques (1h)', 'Plus de 50 erreurs ERROR/CRITICAL sur 1 heure', 'level', 'ERROR', 50, 60, 'high', 30],
    // WARNING surge
    ['Pic de WARNINGs', 'Détecte 100+ warnings sur 15 minutes', 'level', 'WARNING', 100, 15, 'medium', 20],
  ];

  for (const [name, description, conditionType, conditionValue, thresholdValue, timeWindow, severity, cooldown] of allRules) {
    await pool.execute(
      `INSERT INTO alert_rules (name, description, condition_type, condition_value, threshold_value, time_window_minutes, severity, cooldown_minutes, is_active, created_by)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, 1, ?
       WHERE NOT EXISTS (SELECT 1 FROM alert_rules WHERE name = ? AND created_by = ?)`,
      [name, description, conditionType, conditionValue, thresholdValue, timeWindow, severity, cooldown, adminUsers[0].id, name, adminUsers[0].id]
    );
  }
}

async function evalRule(rule, targetUserId = rule.created_by || null) {
  const now = new Date();
  const windowStart = new Date(now.getTime() - rule.time_window_minutes * 60000);
  const conditionType = rule.condition_type;
  const conditionValue = rule.condition_value;
  
  // S-03 & S-07: Retirer OR user_id IS NULL pour éviter les fuites entre tenants
  // Les règles globales (created_by IS NULL) ne doivent plus exister ou doivent être dupliquées par user
  const userFilter = targetUserId ? 'AND user_id = ?' : 'AND 1=0';
  const scopedParams = targetUserId ? [targetUserId] : [];

  if (conditionType === 'level') {
    const [rows] = await pool.execute(
      'SELECT COUNT(*) as cnt FROM logs WHERE timestamp >= ? AND log_level = ? ' + userFilter, // Alerts based on event time
      [windowStart.toISOString().slice(0, 19).replace('T', ' '), normalizeLevel(conditionValue), ...scopedParams]
    );
    if (rows[0].cnt >= (rule.threshold_value ?? 1)) {
      return createAlert(rule, `Level ${conditionValue} detected ${rows[0].cnt} times in last ${rule.time_window_minutes}min`, targetUserId);
    }
  } else if (conditionType === 'count') {
    const [rows] = await pool.execute(
      'SELECT COUNT(*) as cnt FROM logs WHERE timestamp >= ? ' + userFilter, // Alerts based on event time
      [windowStart.toISOString().slice(0, 19).replace('T', ' '), ...scopedParams]
    );
    if (rows[0].cnt >= (rule.threshold_value ?? 100)) {
      return createAlert(rule, `Total log count ${rows[0].cnt} exceeds threshold ${rule.threshold_value} in last ${rule.time_window_minutes}min`, targetUserId);
    }
  } else if (conditionType === 'silence') {
    // FIX #3: Support pour 'Aucune activité'
    const [rows] = await pool.execute( // Alerts based on event time
      'SELECT COUNT(*) as cnt FROM logs WHERE timestamp >= ? ' + userFilter,
      [windowStart.toISOString().slice(0, 19).replace('T', ' '), ...scopedParams]
    );
    if (rows[0].cnt === 0) {
      return createAlert(rule, `Aucune activité depuis ${rule.time_window_minutes} minutes`, targetUserId);
    }
  } else if (conditionType === 'fingerprint') {
    const [rows] = await pool.execute(
      'SELECT COUNT(*) as cnt FROM logs WHERE timestamp >= ? AND fingerprint = ? ' + userFilter, // Alerts based on event time
      [windowStart.toISOString().slice(0, 19).replace('T', ' '), conditionValue, ...scopedParams]
    );
    if (rows[0].cnt >= (rule.threshold_value ?? 1)) {
      return createAlert(rule, `Fingerprint ${conditionValue.slice(0, 12)}... occurred ${rows[0].cnt} times in last ${rule.time_window_minutes}min`, targetUserId);
    }
  } else if (conditionType === 'threshold') {
    const level = normalizeLevel(conditionValue);
    const [rows] = await pool.execute( // Alerts based on event time
      'SELECT log_level, COUNT(*) as cnt FROM logs WHERE timestamp >= ? ' + userFilter + ' GROUP BY log_level',
      [windowStart.toISOString().slice(0, 19).replace('T', ' '), ...scopedParams]
    );
    let triggered = false;
    let msg = '';
    for (const row of rows) {
      if (levelSeverity(row.log_level) >= levelSeverity(level) && row.cnt >= (rule.threshold_value ?? 10)) {
        triggered = true;
        msg = `${row.log_level}: ${row.cnt} occurrences (threshold: ${rule.threshold_value})`;
      }
    }
    if (triggered) {
      return createAlert(
        rule,
        msg || `Level ${conditionValue} detected in last ${rule.time_window_minutes}min`,
        targetUserId
      );
    }
  }
  return null;
}

async function createAlert(rule, message, targetUserId = null) {
  // ✅ BUG #3 CORRIGÉ : cooldown via NOW() MySQL, pas toISOString()
  // AMÉLIORATION 2: Enhanced deduplication - check for identical alerts (same rule_id, user_id, unresolved)
  const userId = targetUserId ?? rule.created_by ?? null;
  
  const [existing] = await pool.execute(
    `SELECT id FROM alerts 
     WHERE rule_id = ? 
     AND user_id <=> ?
     AND resolved_at IS NULL
     AND message = ?
     AND created_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
    [rule.id, userId, message, rule.cooldown_minutes || 30]
  );
  
  if (existing.length > 0) {
    logger.info({ event: 'alert_deduped', ruleId: rule.id, userId }, '[ALERT]');
    return null;
  }

  // AMÉLIORATION 2: Enrich context with detailed information
  const context = {
    triggered_at: new Date().toISOString(),
    rule_name: rule.name,
    condition: `${rule.condition_type} ${rule.condition_value}`,
    count_matched: 0,
    window_minutes: rule.time_window_minutes,
    sample_logs: [],
    affected_modules: [],
    affected_users: []
  };

  // Fetch sample logs and statistics for context
  try {
    const windowStart = new Date(Date.now() - rule.time_window_minutes * 60000);
    const userFilter = userId ? ' AND user_id = ?' : '';
    const params = userId ? [windowStart.toISOString().slice(0, 19).replace('T', ' '), userId] : [windowStart.toISOString().slice(0, 19).replace('T', ' ')];
    
    // Get count and sample logs
    const [samples] = await pool.execute(
      `SELECT id, timestamp, message, module, target_user FROM logs // Sample logs for alert context use event time
       WHERE timestamp >= ? ${userFilter} 
       ORDER BY timestamp DESC LIMIT 3`,
      params
    );
    
    context.count_matched = samples.length;
    context.sample_logs = samples.map(log => ({
      timestamp: log.timestamp,
      message: log.message ? log.message.substring(0, 100) : '',
      module: log.module,
      target_user: log.target_user
    }));
    
    // Get affected modules and users
    const [stats] = await pool.execute(
      `SELECT DISTINCT module, target_user FROM logs // Affected modules/users for alert context use event time
       WHERE timestamp >= ? ${userFilter}
       AND module IS NOT NULL`,
      params
    );
    
    const moduleSet = new Set();
    const userSet = new Set();
    for (const stat of stats) {
      if (stat.module) moduleSet.add(stat.module);
      if (stat.target_user) userSet.add(stat.target_user);
    }
    
    context.affected_modules = Array.from(moduleSet).slice(0, 10);
    context.affected_users = Array.from(userSet).slice(0, 10);
  } catch (e) {
    logger.error({ event: 'enrich_context_error', error: e.message }, '[ALERT]');
  }

  // Insert alert with enriched context
  const [result] = await pool.execute(
    `INSERT INTO alerts (rule_id, alert_type, severity, message, status, metadata, user_id) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      rule.id,
      rule.condition_type,
      rule.severity,
      message,
      'new',
      JSON.stringify(context),
      userId
    ]
  );

  const alert = {
    id: result.insertId,
    rule_id: rule.id,
    alert_type: rule.condition_type,
    severity: rule.severity,
    message,
    metadata: context,
    status: 'new',
    user_id: userId,
    created_at: new Date().toISOString()
  };

  if (alertWorker) {
    alertWorker.broadcastAlert(alert);
  }

  return alert;
}

async function createSmartAlert(userId, alertType, severity, message, metadata = {}, cooldownMinutes = 60) {
  const [existing] = await pool.execute(
    `SELECT id FROM alerts
     WHERE user_id = ?
       AND alert_type = ?
       AND message = ?
       AND resolved_at IS NULL
       AND created_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)
     LIMIT 1`,
    [userId, alertType, message, cooldownMinutes]
  );
  if (existing.length) return null;

  const context = { triggered_at: new Date().toISOString(), ...metadata };
  const [result] = await pool.execute(
    `INSERT INTO alerts (rule_id, alert_type, severity, message, status, metadata, user_id)
     VALUES (NULL, ?, ?, ?, 'new', ?, ?)`,
    [alertType, severity, message, JSON.stringify(context), userId]
  );
  const alert = {
    id: result.insertId,
    rule_id: null,
    alert_type: alertType,
    severity,
    message,
    metadata: context,
    status: 'new',
    user_id: userId,
    created_at: new Date().toISOString()
  };
  if (alertWorker) alertWorker.broadcastAlert(alert);
  return alert;
}

async function evalSmartAlertsForUser(userId) {
  const [returned] = await pool.execute(
    `SELECT fingerprint, title, event_type, error_type, first_seen, previous_seen, last_seen,
            returned_at, return_reason, occurrence_count, source_server, service
     FROM error_groups
     WHERE user_id = ?
       AND status = 'returned'
       AND returned_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
     ORDER BY returned_at DESC
     LIMIT 20`,
    [userId]
  );

  let created = 0;
  for (const group of returned) {
    const message = `Erreur recurrente revenue: ${(group.error_type || group.event_type || 'erreur')} (${String(group.fingerprint || '').slice(0, 12)})`;
    const alert = await createSmartAlert(userId, 'recurring_error_returned', 'high', message, {
      fingerprint: group.fingerprint,
      title: group.title,
      event_type: group.event_type,
      error_type: group.error_type,
      first_seen: group.first_seen,
      previous_seen: group.previous_seen,
      last_seen: group.last_seen,
      returned_at: group.returned_at,
      return_reason: group.return_reason,
      occurrence_count: group.occurrence_count,
      source_server: group.source_server,
      service: group.service
    }, 24 * 60);
    if (alert) created++;
  }

  const [spikes] = await pool.execute(
    `SELECT COALESCE(error_type, event_type, 'unknown') as type_label, COUNT(*) as current_count
     FROM logs
     WHERE user_id = ? // Error spikes are based on event time
       AND timestamp >= DATE_SUB(NOW(), INTERVAL 15 MINUTE) 
       AND log_level IN ('ERROR','CRITICAL','FATAL')
     GROUP BY COALESCE(error_type, event_type, 'unknown')
     HAVING current_count >= 20
     ORDER BY current_count DESC
     LIMIT 10`,
    [userId]
  );

  for (const spike of spikes) {
    const message = `Pic detecte sur ${spike.type_label}: ${spike.current_count} erreurs sur 15 minutes`;
    const alert = await createSmartAlert(userId, 'error_spike_detected', 'high', message, spike, 30);
    if (alert) created++;
  }

  return created;
}

async function evalAllForUser(userId = null) {
  if (!userId) return 0;
  const [rules] = await pool.execute('SELECT * FROM alert_rules WHERE is_active = 1');
  let alertCount = 0;
  const startTime = Date.now();
  
  // FIX #10: Logs de diagnostic
  logger.info({ event: 'starting_alert_evaluation', rulesCount: rules.length, userId: userId || 'all' }, '[ALERT]');
  
  for (const rule of rules) {
    try {
      const alert = await evalRule(rule, userId);
      if (alert) {
        alertCount++;
        logger.info({ event: 'alert_rule_triggered', ruleId: rule.id, ruleName: rule.name, message: alert.message }, '[ALERT]');
      }
    } catch (e) {
      logger.error({ event: 'rule_eval_error', ruleId: rule.id, ruleName: rule.name, error: e.message }, '[ALERT]');
    }
  }
  try {
    alertCount += await evalSmartAlertsForUser(userId);
  } catch (e) {
    logger.error({ event: 'smart_alert_eval_error', userId, error: e.message }, '[ALERT]');
  }
  
  const duration = Date.now() - startTime;
  logger.info({ event: 'alert_evaluation_completed', rulesCount: rules.length, alertsCreated: alertCount, duration: duration + 'ms', userId: userId || 'all' }, '[ALERT]');
  return alertCount;
}

async function evalAll() {
  // FIX BUG-ALERT-02: Les regles globales (created_by IS NULL) ne doivent pas
  // etre evaluees en contexte global sans filtre utilisateur - risque fuite multi-tenant.
  // On itere par utilisateur distinct pour maintenir l'isolation.
  try {
    const [users] = await pool.execute(
      'SELECT id FROM users WHERE is_active = 1'
    );
    let total = 0;
    for (const row of users) {
      total += await evalAllForUser(row.id);
    }
    return total;
  } catch (e) {
    logger.error({ event: 'eval_all_error', error: e.message }, '[ALERT]');
    return 0;
  }
}

export async function startAlertEngine() {
  // FIX #3: Évaluation initiale différée pour laisser le serveur démarrer
  logger.info({ event: 'alert_engine_started' }, '[ALERT]');
  await ensureDefaultAlertRules();

  setTimeout(() => {
    evalAll().catch(e => logger.error({ event: 'init_eval_error', error: e.message }, '[ALERT]'));
  }, 30000);

  // FIX #5: Écoute des événements de logs insérés (principal déclencheur)
  // P-06: Use debounce to prevent concurrent evaluations
  alertEngineBus.on('logs.inserted', ({ userId, count }) => {
    logger.info({ event: 'logs_inserted', userId, count }, '[ALERT]');
    debounceEvalUser(userId);
  });

  // FIX BUG-ALERT-01: SAFETY_INTERVAL = ALERT_EVAL_INTERVAL (60s par defaut) - filet de securite periodique
  logger.info({ event: 'safety_interval_set', interval: SAFETY_INTERVAL + 'ms' }, '[ALERT]');
  safetyTimer = setInterval(() => {
    evalAll().catch(e => logger.error({ event: 'safety_eval_error', error: e.message }, '[ALERT]'));
  }, SAFETY_INTERVAL); // 60s par defaut (configurable via env SAFETY_INTERVAL)

  return { safetyTimer };
}

// Fonction de cleanup pour arrêter le safetyTimer
export function stopAlertEngine() {
  if (safetyTimer) {
    clearInterval(safetyTimer);
    safetyTimer = null;
    logger.info({ event: 'alert_engine_stopped' }, '[ALERT]');
  }
}

// FIX #5: Exporter le bus pour les autres services
export { alertEngineBus };
