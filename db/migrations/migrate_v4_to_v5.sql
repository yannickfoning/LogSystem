-- MIGRATION V4 → V5 (fixed for Aiven MySQL compatibility)

-- 1. Colonne resolved_at dans alerts
ALTER TABLE `alerts`
  ADD COLUMN IF NOT EXISTS `resolved_at` DATETIME NULL DEFAULT NULL AFTER `read_at`;

-- Index sans IF NOT EXISTS (compatible MySQL 5.7+)
DROP PROCEDURE IF EXISTS add_index_alerts_resolved;
DELIMITER //
CREATE PROCEDURE add_index_alerts_resolved()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='alerts' AND INDEX_NAME='idx_alerts_resolved') THEN
    ALTER TABLE `alerts` ADD INDEX `idx_alerts_resolved` (`resolved_at`);
  END IF;
END //
DELIMITER ;
CALL add_index_alerts_resolved();
DROP PROCEDURE IF EXISTS add_index_alerts_resolved;

-- 2. Colonnes manquantes dans import_jobs
ALTER TABLE `import_jobs`
  ADD COLUMN IF NOT EXISTS `skipped_lines`   INT          DEFAULT 0   AFTER `error_message`,
  ADD COLUMN IF NOT EXISTS `import_source`   VARCHAR(255)             AFTER `skipped_lines`,
  ADD COLUMN IF NOT EXISTS `import_service`  VARCHAR(255)             AFTER `import_source`;

-- 3. Table watch_offsets
CREATE TABLE IF NOT EXISTS `watch_offsets` (
  `path`       VARCHAR(1024) PRIMARY KEY,
  `offset`     BIGINT       DEFAULT 0,
  `updated_at` DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. Corriger les alert_rules avec created_by = NULL
UPDATE `alert_rules`
SET    `created_by` = (SELECT `id` FROM `users` WHERE `role` = 'admin' AND `is_active` = 1 ORDER BY `id` ASC LIMIT 1)
WHERE  `created_by` IS NULL;

-- 5. Index de performance (compatibles)
DROP PROCEDURE IF EXISTS add_indexes_v5;
DELIMITER //
CREATE PROCEDURE add_indexes_v5()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='logs' AND INDEX_NAME='idx_logs_user_timestamp') THEN
    ALTER TABLE `logs` ADD INDEX `idx_logs_user_timestamp` (`user_id`, `timestamp`);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='logs' AND INDEX_NAME='idx_logs_fingerprint') THEN
    ALTER TABLE `logs` ADD INDEX `idx_logs_fingerprint` (`fingerprint`);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='logs' AND INDEX_NAME='idx_logs_level') THEN
    ALTER TABLE `logs` ADD INDEX `idx_logs_level` (`log_level`);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='logs' AND INDEX_NAME='idx_logs_timestamp') THEN
    ALTER TABLE `logs` ADD INDEX `idx_logs_timestamp` (`timestamp`);
  END IF;
END //
DELIMITER ;
CALL add_indexes_v5();
DROP PROCEDURE IF EXISTS add_indexes_v5;
