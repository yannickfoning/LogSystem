-- LogSystem V6 Migration (fixed for Aiven MySQL - no IF NOT EXISTS on indexes)
SET FOREIGN_KEY_CHECKS = 0;

-- 1. ENRICHISSEMENT DES COLONNES DE TEMPS
ALTER TABLE `logs`
  ADD COLUMN IF NOT EXISTS `created_at_log` DATETIME NULL COMMENT 'Date brute extraite du texte',
  ADD COLUMN IF NOT EXISTS `created_time_log` TIME NULL COMMENT 'Heure brute extraite du texte',
  ADD COLUMN IF NOT EXISTS `imported_time` TIME NULL COMMENT 'Heure d import dans le systeme',
  ADD COLUMN IF NOT EXISTS `file_created_at` DATETIME NULL COMMENT 'Date de creation fs.stat birthtime',
  ADD COLUMN IF NOT EXISTS `file_modified_at` DATETIME NULL COMMENT 'Date de modification fs.stat mtime';

UPDATE `logs` SET `imported_time` = TIME(`imported_at`) WHERE `imported_time` IS NULL AND `imported_at` IS NOT NULL;

-- 2. INDEX (compatibles Aiven MySQL)
DROP PROCEDURE IF EXISTS add_indexes_v6;
DELIMITER //
CREATE PROCEDURE add_indexes_v6()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='logs' AND INDEX_NAME='idx_audit_severity') THEN
    ALTER TABLE `logs` ADD INDEX `idx_audit_severity` (`log_level`);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='logs' AND INDEX_NAME='idx_audit_timestamp') THEN
    ALTER TABLE `logs` ADD INDEX `idx_audit_timestamp` (`timestamp`);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='logs' AND INDEX_NAME='idx_audit_source') THEN
    ALTER TABLE `logs` ADD INDEX `idx_audit_source` (`source`);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='logs' AND INDEX_NAME='idx_audit_user_id') THEN
    ALTER TABLE `logs` ADD INDEX `idx_audit_user_id` (`user_id`);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='logs' AND INDEX_NAME='idx_logs_combined_search') THEN
    ALTER TABLE `logs` ADD INDEX `idx_logs_combined_search` (`user_id`, `log_level`, `source`, `timestamp`);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='audit_log' AND INDEX_NAME='idx_audit_timestamp2') THEN
    ALTER TABLE `audit_log` ADD INDEX `idx_audit_timestamp2` (`created_at`);
  END IF;
END //
DELIMITER ;
CALL add_indexes_v6();
DROP PROCEDURE IF EXISTS add_indexes_v6;

-- 3. ALERTES PAR DÉFAUT
INSERT INTO `alert_rules` (`id`, `name`, `description`, `condition_type`, `condition_value`, `threshold_value`, `time_window_minutes`, `severity`, `cooldown_minutes`, `is_active`, `created_by`)
SELECT
  v.id, v.name, v.description, v.condition_type, v.condition_value,
  v.threshold_value, v.time_window_minutes, v.severity, v.cooldown_minutes, 1, a.id
FROM (
  SELECT 101 AS id, 'ERROR_LIMIT' AS name, '10 erreurs / 5 minutes' AS description, 'threshold' AS condition_type, 'ERROR' AS condition_value, 10 AS threshold_value, 5 AS time_window_minutes, 'high' AS severity, 10 AS cooldown_minutes
  UNION ALL SELECT 102, 'FATAL_TRIGGER', '1 occurrence FATAL', 'threshold', 'FATAL', 1, 1, 'critical', 5
  UNION ALL SELECT 103, 'SECURITY_BREACH', '3 events de securite', 'threshold', 'SECURITY', 3, 15, 'critical', 10
  UNION ALL SELECT 104, 'AUTH_BRUTEFORCE', '5 echecs auth', 'threshold', 'AUTH', 5, 10, 'high', 15
  UNION ALL SELECT 105, 'DISK_THRESHOLD', 'Disque > 80%', 'threshold', 'DISK', 80, 5, 'medium', 60
) v
JOIN (SELECT id FROM users WHERE role = 'admin' AND is_active = 1) a
WHERE NOT EXISTS (
  SELECT 1 FROM `alert_rules` r WHERE r.`name` = v.`name` AND r.`created_by` = a.id
);

-- 4. import_summary column
ALTER TABLE `import_jobs`
  ADD COLUMN IF NOT EXISTS `import_summary` JSON NULL AFTER `skipped_lines`;

SET FOREIGN_KEY_CHECKS = 1;
