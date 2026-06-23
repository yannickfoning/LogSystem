-- LogSystem v6.0 — Metadata, global alerts, audit retrofill, unique constraint

ALTER TABLE `logs` ADD COLUMN `file_name` VARCHAR(255) NULL;
ALTER TABLE `logs` ADD COLUMN `imported_by_user_id` INT NULL;
ALTER TABLE `logs` ADD COLUMN `import_job_id` VARCHAR(36) NULL;
ALTER TABLE `logs` ADD COLUMN `log_source` VARCHAR(255) NULL;
ALTER TABLE `logs` ADD COLUMN `log_user` VARCHAR(255) NULL;

ALTER TABLE `alert_rules` ADD COLUMN `is_global` TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE `alert_rules` ADD COLUMN `applicable_to_users` JSON NULL;
ALTER TABLE `alert_rules` MODIFY COLUMN `condition_type` ENUM('level','count','fingerprint','threshold','silence','error_rate','level_count','import_status','log_inactivity','anomaly') NOT NULL;

ALTER TABLE `import_jobs` ADD COLUMN `successful_lines` INT DEFAULT 0;
ALTER TABLE `import_jobs` ADD COLUMN `failed_lines` INT DEFAULT 0;

CREATE INDEX idx_logs_imported_at ON logs (imported_at);
CREATE INDEX idx_logs_log_source ON logs (log_source);
CREATE INDEX idx_logs_log_user ON logs (log_user);
CREATE INDEX idx_logs_import_job ON logs (import_job_id);
CREATE UNIQUE INDEX idx_unique_log ON logs (user_id, timestamp, message(100));

INSERT INTO audit_log (user_id, user_email, action, resource_type, resource_id, details, created_at)
SELECT
  j.user_id,
  u.email,
  'import_completed',
  'import_job',
  j.id,
  JSON_OBJECT('file_name', j.filename, 'lines', COALESCE(j.processed_lines, 0)),
  COALESCE(j.completed_at, j.created_at)
FROM import_jobs j
LEFT JOIN users u ON u.id = j.user_id
WHERE j.status IN ('completed', 'COMPLETED')
  AND j.completed_at > DATE_SUB(NOW(), INTERVAL 90 DAY)
  AND NOT EXISTS (
    SELECT 1 FROM audit_log a
    WHERE a.action = 'import_completed'
      AND a.resource_type = 'import_job'
      AND a.resource_id = j.id
  );

INSERT INTO alert_rules (name, description, condition_type, condition_value, threshold_value, time_window_minutes, severity, cooldown_minutes, is_active, is_global, applicable_to_users, created_by)
SELECT 'Error Rate High', 'Taux d''erreur > 10% dans les 5 dernières minutes', 'error_rate', '10', 10, 5, 'high', 10, 1, 1, '[]', NULL
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM alert_rules WHERE name = 'Error Rate High' AND is_global = 1);

INSERT INTO alert_rules (name, description, condition_type, condition_value, threshold_value, time_window_minutes, severity, cooldown_minutes, is_active, is_global, applicable_to_users, created_by)
SELECT 'Critical Log Detected', 'Au moins 1 log CRITICAL ou FATAL détecté', 'level_count', 'CRITICAL|FATAL', 1, 5, 'critical', 5, 1, 1, '[]', NULL
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM alert_rules WHERE name = 'Critical Log Detected' AND is_global = 1);

INSERT INTO alert_rules (name, description, condition_type, condition_value, threshold_value, time_window_minutes, severity, cooldown_minutes, is_active, is_global, applicable_to_users, created_by)
SELECT 'Import Failure', 'Une tâche d''import a échoué', 'import_status', 'FAILED', 1, 60, 'high', 15, 1, 1, '[]', NULL
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM alert_rules WHERE name = 'Import Failure' AND is_global = 1);

INSERT INTO alert_rules (name, description, condition_type, condition_value, threshold_value, time_window_minutes, severity, cooldown_minutes, is_active, is_global, applicable_to_users, created_by)
SELECT 'No Logs in 1 Hour', 'Aucun log reçu depuis 60 minutes', 'log_inactivity', '60', 0, 60, 'medium', 60, 1, 1, '[]', NULL
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM alert_rules WHERE name = 'No Logs in 1 Hour' AND is_global = 1);

INSERT INTO alert_rules (name, description, condition_type, condition_value, threshold_value, time_window_minutes, severity, cooldown_minutes, is_active, is_global, applicable_to_users, created_by)
SELECT 'Anomaly Detected', 'Détection d''anomalie (z-score > 2.5)', 'anomaly', '2.5', 1, 60, 'medium', 30, 1, 1, '[]', NULL
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM alert_rules WHERE name = 'Anomaly Detected' AND is_global = 1);
