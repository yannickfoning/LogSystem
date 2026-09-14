import logger from '../config/logger.js';
import pool, { levelSeverity, normalizeLevel } from '../config/database.js';
import EventEmitter from 'events';
import { detectVolumeAnomalies } from './anomaliesService.js';
import {
  OPERATIONAL_TS,
  OPERATIONAL_TS_EXPR,
  isCloudDeployment,
  toMysqlUtcDatetime,
  mysqlUtcMinutesAgo,
} from '../lib/operationalTime.js';

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
  try {
    const [globalRows] = await pool.execute('SELECT COUNT(*) as cnt FROM alert_rules WHERE is_active = 1 AND is_global = 1');
    if (globalRows[0].cnt > 0) return;
  } catch (e) {
    if (!/Unknown column.*is_global/i.test(e.message)) throw e;
    const [rows] = await pool.execute('SELECT COUNT(*) as cnt FROM alert_rules WHERE is_active = 1');
    if (rows[0].cnt > 0) return;
  }

  logger.info({ event: 'seeding_default_alert_rules' }, '[ALERT]');
  const [adminUsers] = await pool.execute("SELECT id FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 1");
  const creatorId = adminUsers[0]?.id || null;
  if (!creatorId) { logger.info({ event: 'no_admin_users_seeding_skipped' }, '[ALERT]'); return; }

  const allRules = [
    ['Erreurs fréquentes (ERROR)', 'Détecte 10+ erreurs ERROR sur 5 minutes', 'level', 'ERROR', 10, 5, 'high', 10],
    ['FATAL détecté', 'Alerte immédiate sur toute occurrence FATAL', 'level', 'FATAL', 1, 60, 'critical', 5],
    ['CRITICAL détecté', 'Alerte immédiate sur toute occurrence CRITICAL', 'level', 'CRITICAL', 1, 60, 'critical', 10],
    ['Événements sécurité', 'Détecte 3+ événements de sécurité', 'level', 'SECURITY', 3, 30, 'critical', 15],
    ['Volume anormal', 'Alerte sur un volume de logs inhabituel (5000/h)', 'count', 'all', 5000, 60, 'medium', 60],
    ['Erreurs critiques (1h)', 'Plus de 50 erreurs ERROR/CRITICAL sur 1 heure', 'level', 'ERROR', 50, 60, 'high', 30],
    ['Pic de WARNINGs', 'Détecte 100+ warnings sur 15 minutes', 'level', 'WARNING', 100, 15, 'medium', 20],
  ];

  for (const [name, description, conditionType, conditionValue, thresholdValue, timeWindow, severity, cooldown] of allRules) {
    await pool.execute(
      `INSERT INTO alert_rules (name, description, condition_type, condition_value, threshold_value, time_window_minutes, severity, cooldown_minutes, is_active, is_global, applicable_to_users, created_by)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, NULL, ?
       WHERE NOT EXISTS (SELECT 1 FROM alert_rules WHERE name = ? AND is_global = 1)`,
      [name, description, conditionType, conditionValue, thresholdValue, timeWindow, severity, cooldown, creatorId, name]
    );
  }
}

// Helper function to parse condition_value in both JSON and STRING formats
function parseConditionValue(conditionValue, rule) {
  // Try JSON format first (legacy format)
  if (conditionValue && typeof conditionValue === 'string' && conditionValue.startsWith('{')) {
    try {
      const parsed = JSON.parse(conditionValue);
      // Map legacy JSON keys to modern format
      if (parsed.level) return { value: parsed.level, threshold: parsed.count || 1 };
      if (parsed.count) return { value: null, threshold: parsed.count };
      return { value: null, threshold: 1 };
    } catch (e) {
      // If JSON parsing fails, fall back to string treatment
      logger.warn({ event: 'json_parse_failed', conditionValue, error: e.message }, '[ALERT]');
    }
  }
  
  // Modern STRING format: use condition_value directly and threshold_value from rule
  return { value: conditionValue, threshold: rule.threshold_value };
}

async function evalRule(rule, targetUserId = rule.created_by || null) {
  const now = new Date();
  const windowStartFormatted = mysqlUtcMinutesAgo(rule.time_window_minutes, now);
  const conditionType = rule.condition_type;
  const conditionValue = rule.condition_value;
  const tsCol = OPERATIONAL_TS;
  
  const userFilter = targetUserId ? 'AND user_id = ?' : 'AND 1=0';
  const scopedParams = targetUserId ? [targetUserId] : [];
  
  // Parse condition_value to support both JSON and STRING formats
  const parsed = parseConditionValue(conditionValue, rule);
  const effectiveValue = parsed.value !== null ? parsed.value : conditionValue;
  const effectiveThreshold = parsed.threshold !== undefined ? parsed.threshold : rule.threshold_value;

  if (conditionType === 'level') {
    const [rows] = await pool.execute(
      `SELECT COUNT(*) as cnt FROM logs WHERE ${tsCol} >= ? AND log_level = ? ` + userFilter,
      [windowStartFormatted, normalizeLevel(effectiveValue), ...scopedParams]
    );
    
    // DIAGNOSTIC LOG: Log condition evaluation details
    const countValue = rows[0].cnt;
    const thresholdValue = effectiveThreshold ?? 1;
    const conditionResult = countValue >= thresholdValue;
    
    logger.info({ 
      event: 'rule_condition_eval', 
      ruleId: rule.id, 
      ruleName: rule.name,
      conditionType, 
      effectiveValue, 
      countValue, 
      thresholdValue, 
      conditionResult,
      windowStart: windowStartFormatted,
      userFilter,
      scopedParams
    }, '[ALERT] DIAGNOSTIC');
    
    if (conditionResult) {
      logger.info({ event: 'rule_condition_true_calling_createAlert', ruleId: rule.id, countValue, thresholdValue }, '[ALERT] DIAGNOSTIC');
      return createAlert(rule, `Level ${effectiveValue} detected ${rows[0].cnt} times in last ${rule.time_window_minutes}min`, targetUserId);
    } else {
      logger.info({ event: 'rule_condition_false_skipping_createAlert', ruleId: rule.id, countValue, thresholdValue }, '[ALERT] DIAGNOSTIC');
    }
  } else if (conditionType === 'count') {
    const [rows] = await pool.execute(
      `SELECT COUNT(*) as cnt FROM logs WHERE ${tsCol} >= ? ` + userFilter,
      [windowStartFormatted, ...scopedParams]
    );
    if (rows[0].cnt >= (effectiveThreshold ?? 100)) {
      return createAlert(rule, `Total log count ${rows[0].cnt} exceeds threshold ${effectiveThreshold} in last ${rule.time_window_minutes}min`, targetUserId);
    }
  } else if (conditionType === 'silence') {
    const [rows] = await pool.execute(
      `SELECT COUNT(*) as cnt FROM logs WHERE ${tsCol} >= ? ` + userFilter,
      [windowStartFormatted, ...scopedParams]
    );
    if (rows[0].cnt === 0) {
      return createAlert(rule, `Aucune activité depuis ${rule.time_window_minutes} minutes`, targetUserId);
    }
  } else if (conditionType === 'fingerprint') {
    const [rows] = await pool.execute(
      `SELECT COUNT(*) as cnt FROM logs WHERE ${tsCol} >= ? AND fingerprint = ? ` + userFilter,
      [windowStartFormatted, effectiveValue, ...scopedParams]
    );
    if (rows[0].cnt >= (effectiveThreshold ?? 1)) {
      return createAlert(rule, `Fingerprint ${effectiveValue.slice(0, 12)}... occurred ${rows[0].cnt} times in last ${rule.time_window_minutes}min`, targetUserId);
    }
  } else if (conditionType === 'threshold') {
    const level = normalizeLevel(effectiveValue);
    const [rows] = await pool.execute(
      `SELECT log_level, COUNT(*) as cnt FROM logs WHERE ${tsCol} >= ? ` + userFilter + ' GROUP BY log_level',
      [windowStartFormatted, ...scopedParams]
    );
    let triggered = false;
    let msg = '';
    for (const row of rows) {
      if (levelSeverity(row.log_level) >= levelSeverity(level) && row.cnt >= (effectiveThreshold ?? 10)) {
        triggered = true;
        msg = `${row.log_level}: ${row.cnt} occurrences (threshold: ${effectiveThreshold})`;
      }
    }
    if (triggered) {
      return createAlert(
        rule,
        msg || `Level ${effectiveValue} detected in last ${rule.time_window_minutes}min`,
        targetUserId
      );
    }
  } else if (conditionType === 'error_rate') {
    const [rows] = await pool.execute(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN log_level IN ('ERROR','CRITICAL','FATAL') THEN 1 ELSE 0 END) as errors
       FROM logs WHERE ${tsCol} >= ? ${userFilter}`,
      [windowStartFormatted, ...scopedParams]
    );
    const total = rows[0]?.total || 0;
    const errors = rows[0]?.errors || 0;
    const rate = total > 0 ? Math.min(100, (errors / total) * 100) : 0;
    const threshold = parseFloat(effectiveValue) || effectiveThreshold || 10;
    if (total > 0 && rate > threshold) {
      return createAlert(rule, `Taux d'erreur ${rate.toFixed(1)}% (> ${threshold}%) sur ${rule.time_window_minutes} min`, targetUserId);
    }
  } else if (conditionType === 'level_count') {
    const levels = String(effectiveValue || '').split('|').map(normalizeLevel);
    const placeholders = levels.map(() => '?').join(',');
    const [rows] = await pool.execute(
      `SELECT COUNT(*) as cnt FROM logs WHERE ${tsCol} >= ? AND log_level IN (${placeholders}) ${userFilter}`,
      [windowStartFormatted, ...levels, ...scopedParams]
    );
    if (rows[0].cnt >= (effectiveThreshold ?? 1)) {
      return createAlert(rule, `${rows[0].cnt} log(s) ${effectiveValue} détecté(s)`, targetUserId);
    }
  } else if (conditionType === 'import_status') {
    const scopeUser = targetUserId ? 'AND user_id = ?' : '';
    const [rows] = await pool.execute(
      `SELECT COUNT(*) as cnt FROM import_jobs WHERE status = 'failed' AND completed_at >= ? ${scopeUser}`,
      [windowStartFormatted, ...(targetUserId ? [targetUserId] : [])]
    );
    if (rows[0].cnt >= (rule.threshold_value ?? 1)) {
      return createAlert(rule, `${rows[0].cnt} import(s) échoué(s) récemment`, targetUserId);
    }
  } else if (conditionType === 'log_inactivity') {
    const minutes = parseInt(effectiveValue, 10) || rule.time_window_minutes || 60;
    const sinceFormatted = mysqlUtcMinutesAgo(minutes, now);
    const [rows] = await pool.execute(
      `SELECT COUNT(*) as cnt FROM logs WHERE ${tsCol} >= ? ` + userFilter,
      [sinceFormatted, ...scopedParams]
    );
    if (rows[0].cnt === 0) {
      return createAlert(rule, `Aucun log reçu depuis ${minutes} minutes`, targetUserId);
    }
  } else if (conditionType === 'anomaly') {
    if (targetUserId) {
      await detectVolumeAnomalies(targetUserId);
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
    const windowStartFormatted = mysqlUtcMinutesAgo(rule.time_window_minutes);
    const userFilter = userId ? ' AND user_id = ?' : '';
    const params = userId ? [windowStartFormatted, userId] : [windowStartFormatted];
    
    // Get count and sample logs
    const tsCol = OPERATIONAL_TS;
    const [samples] = await pool.execute(
      `SELECT id, timestamp, imported_at, message, module, target_user FROM logs 
       WHERE ${tsCol} >= ? ${userFilter} 
       ORDER BY ${tsCol} DESC LIMIT 3`,
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
      `SELECT DISTINCT module, target_user FROM logs 
       WHERE ${tsCol} >= ? ${userFilter}
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
     WHERE user_id = ? 
       AND ${OPERATIONAL_TS} >= DATE_SUB(NOW(), INTERVAL 15 MINUTE) 
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

/** Run alert evaluation after log ingestion (Render/Vercel: direct eval + event bus). */
export async function triggerPostIngestAlerts(userId, count, summary = null) {
  if (!userId || !count) return;
  if (isCloudDeployment()) {
    try {
      await evalAllForUser(userId);
    } catch (e) {
      logger.error({ event: 'post_ingest_alert_eval_failed', userId, error: e.message }, '[ALERT]');
    }
  }
  setImmediate(() => {
    alertEngineBus.emit('logs.inserted', { userId, count, summary });
  });
}

export async function evalAllForUser(userId = null) {
  if (!userId) return 0;
  const [rules] = await pool.execute(
    `SELECT * FROM alert_rules WHERE is_active = 1 AND (
      (is_global = 1 AND (
        applicable_to_users IS NULL
        OR applicable_to_users = '[]'
        OR JSON_CONTAINS(applicable_to_users, CAST(? AS CHAR), '$')
      ))
      OR (COALESCE(is_global, 0) = 0 AND created_by = ?)
    )`,
    [String(userId), userId]
  );
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
    
    const timeout = (ms) => new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`Evaluation timeout after ${ms}ms`)), ms)
    );

    for (const row of users) {
      // P-03: Protection individuelle par utilisateur pour garantir la continuité du cycle
      try {
        total += await Promise.race([evalAllForUser(row.id), timeout(30000)]);
      } catch (userEvalError) {
        // L'échec d'un utilisateur n'arrête pas la boucle globale
        logger.error({ event: 'eval_user_failed', userId: row.id, error: userEvalError.message, nextAction: 'continuing_loop' }, '[ALERT]');
      }
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
