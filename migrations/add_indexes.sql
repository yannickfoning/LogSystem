-- FIX #9: Index DB pour optimiser evalRule
-- Créé le 2026-05-12 pour LogSystem V4

-- Index composites pour les requêtes alertEngine
-- Optimise les requêtes WHERE timestamp >= ? AND user_id = ? AND log_level = ?
CREATE INDEX IF NOT EXISTS idx_logs_user_ts_level ON logs (user_id, timestamp, log_level);

-- Optimise les requêtes WHERE timestamp >= ? AND user_id = ? AND fingerprint = ?
CREATE INDEX IF NOT EXISTS idx_logs_user_ts_fp ON logs (user_id, timestamp, fingerprint);

-- Optimise les requêtes WHERE timestamp >= ? AND user_id = ?
CREATE INDEX IF NOT EXISTS idx_logs_user_ts ON logs (user_id, timestamp);

-- Index pour les alertes (jointures et tri)
CREATE INDEX IF NOT EXISTS idx_alerts_rule_created ON alerts (rule_id, created_at);

-- Index pour les règles actives
CREATE INDEX IF NOT EXISTS idx_alert_rules_active ON alert_rules (is_active, created_by);

-- Index unique pour déduplication (supporte INSERT IGNORE)
-- Note: fingerprint peut être NULL, donc on utilise une colonne calculée
ALTER TABLE logs 
ADD UNIQUE KEY IF NOT EXISTS uniq_log (
    COALESCE(fingerprint, 'NULL'), 
    timestamp, 
    COALESCE(user_id, -1),
    COALESCE(raw_log, '')
);

-- Index pour error_groups (fréquemment mis à jour)
CREATE INDEX IF NOT EXISTS idx_error_groups_fp ON error_groups (fingerprint);

-- Index pour les requêtes de monitoring/dashboard
CREATE INDEX IF NOT EXISTS idx_logs_level_ts ON logs (log_level, timestamp);
CREATE INDEX IF NOT EXISTS idx_logs_service_ts ON logs (service, timestamp);

-- Afficher les index créés pour vérification
SHOW INDEX FROM logs;
SHOW INDEX FROM alerts;
SHOW INDEX FROM alert_rules;
SHOW INDEX FROM error_groups;
