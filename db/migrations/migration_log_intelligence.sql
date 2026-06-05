-- migration_log_intelligence (Aiven MySQL compatible — no DELIMITER)

ALTER TABLE logs
  ADD COLUMN IF NOT EXISTS created_time TIME NULL AFTER timestamp,
  ADD COLUMN IF NOT EXISTS imported_at DATETIME DEFAULT CURRENT_TIMESTAMP AFTER created_time,
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) NULL AFTER imported_at,
  ADD COLUMN IF NOT EXISTS source_server VARCHAR(255) NULL AFTER source,
  ADD COLUMN IF NOT EXISTS parser_format VARCHAR(50) NULL AFTER target_user,
  ADD COLUMN IF NOT EXISTS timestamp_inferred TINYINT(1) DEFAULT 0 AFTER parser_format,
  ADD COLUMN IF NOT EXISTS classification_confidence DECIMAL(4,3) DEFAULT 0.500 AFTER timestamp_inferred;

UPDATE logs SET imported_at = COALESCE(imported_at, created_at, NOW()) WHERE imported_at IS NULL;
UPDATE logs SET source_server = COALESCE(source_server, source) WHERE source_server IS NULL;
UPDATE logs SET created_time = COALESCE(created_time, TIME(timestamp)) WHERE created_time IS NULL;

ALTER TABLE `logs` ADD INDEX `idx_logs_source_server` (`source_server`);
ALTER TABLE `logs` ADD INDEX `idx_logs_error_type` (`error_type`);
ALTER TABLE `logs` ADD INDEX `idx_logs_user_error_type_ts` (`user_id`, `error_type`, `timestamp`);
ALTER TABLE `logs` ADD INDEX `idx_logs_user_fingerprint_ts` (`user_id`, `fingerprint`, `timestamp`);
ALTER TABLE `logs` ADD INDEX `idx_logs_imported_at` (`imported_at`);

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

ALTER TABLE `error_groups` ADD INDEX `idx_error_groups_status_last` (`status`, `last_seen`);
ALTER TABLE `error_groups` ADD INDEX `idx_error_groups_error_type` (`error_type`);
