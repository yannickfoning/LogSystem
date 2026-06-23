-- LogSystem V6 (Aiven MySQL 100% compatible)

ALTER TABLE `logs` ADD COLUMN `created_at_log` DATETIME NULL;
ALTER TABLE `logs` ADD COLUMN `created_time_log` TIME NULL;
ALTER TABLE `logs` ADD COLUMN `imported_time` TIME NULL;
ALTER TABLE `logs` ADD COLUMN `file_created_at` DATETIME NULL;
ALTER TABLE `logs` ADD COLUMN `file_modified_at` DATETIME NULL;

ALTER TABLE `import_jobs` ADD COLUMN `import_summary` JSON NULL;

ALTER TABLE `logs` ADD INDEX `idx_audit_severity` (`log_level`);
ALTER TABLE `logs` ADD INDEX `idx_audit_timestamp` (`timestamp`);
ALTER TABLE `logs` ADD INDEX `idx_audit_source` (`source`);
ALTER TABLE `logs` ADD INDEX `idx_audit_user_id` (`user_id`);
ALTER TABLE `logs` ADD INDEX `idx_logs_combined_search` (`user_id`, `log_level`, `source`, `timestamp`);
ALTER TABLE `audit_log` ADD INDEX `idx_audit_timestamp2` (`created_at`);

INSERT INTO `alert_rules` (`id`, `name`, `description`, `condition_type`, `condition_value`, `threshold_value`, `time_window_minutes`, `severity`, `cooldown_minutes`, `is_active`, `created_by`)
SELECT v.id, v.name, v.description, v.condition_type, v.condition_value,
  v.threshold_value, v.time_window_minutes, v.severity, v.cooldown_minutes, 1, a.id
FROM (
  SELECT 101 AS id, 'ERROR_LIMIT' AS name, '10 erreurs / 5 minutes' AS description, 'threshold' AS condition_type, 'ERROR' AS condition_value, 10 AS threshold_value, 5 AS time_window_minutes, 'high' AS severity, 10 AS cooldown_minutes
  UNION ALL SELECT 102, 'FATAL_TRIGGER', '1 occurrence FATAL', 'threshold', 'FATAL', 1, 1, 'critical', 5
  UNION ALL SELECT 103, 'SECURITY_BREACH', '3 events securite', 'threshold', 'SECURITY', 3, 15, 'critical', 10
  UNION ALL SELECT 104, 'AUTH_BRUTEFORCE', '5 echecs auth', 'threshold', 'AUTH', 5, 10, 'high', 15
  UNION ALL SELECT 105, 'DISK_THRESHOLD', 'Disque > 80%', 'threshold', 'DISK', 80, 5, 'medium', 60
) v
JOIN (SELECT id FROM users WHERE role = 'admin' AND is_active = 1) a
WHERE NOT EXISTS (
  SELECT 1 FROM `alert_rules` r WHERE r.`name` = v.`name` AND r.`created_by` = a.id
);