-- migration_log_intelligence.sql (fixed for Aiven MySQL - no IF NOT EXISTS on indexes)

ALTER TABLE logs
  ADD COLUMN IF NOT EXISTS created_time TIME NULL AFTER timestamp,
  ADD COLUMN IF NOT EXISTS imported_at DATETIME DEFAULT CURRENT_TIMESTAMP AFTER created_time,
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) NULL AFTER imported_at,
  ADD COLUMN IF NOT EXISTS source_server VARCHAR(255) NULL AFTER source,
  ADD COLUMN IF NOT EXISTS parser_format VARCHAR(50) NULL AFTER target_user,
  ADD COLUMN IF NOT EXISTS timestamp_inferred TINYINT(1) DEFAULT 0 AFTER parser_format,
  ADD COLUMN IF NOT EXISTS classification_confidence DECIMAL(4,3) DEFAULT 0.500 AFTER timestamp_inferred;

UPDATE logs SET imported_at = COALESCE(imported_at, created_at, NOW());
UPDATE logs SET source_server = COALESCE(source_server, source);
UPDATE logs SET created_time = COALESCE(created_time, TIME(timestamp));

DROP PROCEDURE IF EXISTS add_indexes_log_intel;
DELIMITER //
CREATE PROCEDURE add_indexes_log_intel()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='logs' AND INDEX_NAME='idx_logs_source_server') THEN
    ALTER TABLE `logs` ADD INDEX `idx_logs_source_server` (`source_server`);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='logs' AND INDEX_NAME='idx_logs_error_type') THEN
    ALTER TABLE `logs` ADD INDEX `idx_logs_error_type` (`error_type`);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='logs' AND INDEX_NAME='idx_logs_user_error_type_ts') THEN
    ALTER TABLE `logs` ADD INDEX `idx_logs_user_error_type_ts` (`user_id`, `error_type`, `timestamp`);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='logs' AND INDEX_NAME='idx_logs_user_fingerprint_ts') THEN
    ALTER TABLE `logs` ADD INDEX `idx_logs_user_fingerprint_ts` (`user_id`, `fingerprint`, `timestamp`);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='logs' AND INDEX_NAME='idx_logs_imported_at') THEN
    ALTER TABLE `logs` ADD INDEX `idx_logs_imported_at` (`imported_at`);
  END IF;
END //
DELIMITER ;
CALL add_indexes_log_intel();
DROP PROCEDURE IF EXISTS add_indexes_log_intel;

ALTER TABLE error_groups
  ADD COLUMN IF NOT EXISTS previous_seen DATETIME NULL AFTER last_seen,
  ADD COLUMN IF NOT EXISTS resolved_at DATETIME NULL AFTER previous_seen,
  ADD COLUMN IF NOT EXISTS returned_at DATETIME NULL AFTER resolved_at,
  ADD COLUMN IF NOT EXISTS return_count INT DEFAULT 0 AFTER returned_at,
  ADD COLUMN IF NOT EXISTS return_reason TEXT NULL AFTER return_count,
  ADD COLUMN IF NOT EXISTS source_server VARCHAR(255) NULL AFTER return_reason,
  ADD COLUMN IF NOT EXISTS service VARCHAR(255) NULL AFTER source_server,
  ADD COLUMN IF NOT EXISTS error_type VARCHAR(100) NULL AFTER service;

ALTER TABLE error_groups
  MODIFY COLUMN status ENUM('open','resolved','returned') DEFAULT 'open';

DROP PROCEDURE IF EXISTS add_indexes_error_groups;
DELIMITER //
CREATE PROCEDURE add_indexes_error_groups()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='error_groups' AND INDEX_NAME='idx_error_groups_status_last') THEN
    ALTER TABLE `error_groups` ADD INDEX `idx_error_groups_status_last` (`status`, `last_seen`);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='error_groups' AND INDEX_NAME='idx_error_groups_error_type') THEN
    ALTER TABLE `error_groups` ADD INDEX `idx_error_groups_error_type` (`error_type`);
  END IF;
END //
DELIMITER ;
CALL add_indexes_error_groups();
DROP PROCEDURE IF EXISTS add_indexes_error_groups;
