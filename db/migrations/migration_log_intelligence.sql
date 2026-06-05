-- migration_log_intelligence (Aiven MySQL 100% compatible)

ALTER TABLE logs ADD COLUMN created_time TIME NULL AFTER timestamp;
ALTER TABLE logs ADD COLUMN imported_at DATETIME DEFAULT CURRENT_TIMESTAMP AFTER created_time;
ALTER TABLE logs ADD COLUMN timezone VARCHAR(64) NULL AFTER imported_at;
ALTER TABLE logs ADD COLUMN source_server VARCHAR(255) NULL AFTER source;
ALTER TABLE logs ADD COLUMN parser_format VARCHAR(50) NULL AFTER target_user;
ALTER TABLE logs ADD COLUMN timestamp_inferred TINYINT(1) DEFAULT 0 AFTER parser_format;
ALTER TABLE logs ADD COLUMN classification_confidence DECIMAL(4,3) DEFAULT 0.500 AFTER timestamp_inferred;

UPDATE logs SET imported_at = COALESCE(imported_at, created_at, NOW()) WHERE imported_at IS NULL;
UPDATE logs SET source_server = COALESCE(source_server, source) WHERE source_server IS NULL;
UPDATE logs SET created_time = COALESCE(created_time, TIME(timestamp)) WHERE created_time IS NULL;

ALTER TABLE `logs` ADD INDEX `idx_logs_source_server` (`source_server`);
ALTER TABLE `logs` ADD INDEX `idx_logs_error_type` (`error_type`);
ALTER TABLE `logs` ADD INDEX `idx_logs_user_error_type_ts` (`user_id`, `error_type`, `timestamp`);
ALTER TABLE `logs` ADD INDEX `idx_logs_user_fingerprint_ts` (`user_id`, `fingerprint`, `timestamp`);
ALTER TABLE `logs` ADD INDEX `idx_logs_imported_at` (`imported_at`);

ALTER TABLE error_groups ADD COLUMN previous_seen DATETIME NULL AFTER last_seen;
ALTER TABLE error_groups ADD COLUMN resolved_at DATETIME NULL AFTER previous_seen;
ALTER TABLE error_groups ADD COLUMN returned_at DATETIME NULL AFTER resolved_at;
ALTER TABLE error_groups ADD COLUMN return_count INT DEFAULT 0 AFTER returned_at;
ALTER TABLE error_groups ADD COLUMN return_reason TEXT NULL AFTER return_count;
ALTER TABLE error_groups ADD COLUMN source_server VARCHAR(255) NULL AFTER return_reason;
ALTER TABLE error_groups ADD COLUMN service VARCHAR(255) NULL AFTER source_server;
ALTER TABLE error_groups ADD COLUMN error_type VARCHAR(100) NULL AFTER service;

ALTER TABLE error_groups MODIFY COLUMN status ENUM('open','resolved','returned') DEFAULT 'open';

ALTER TABLE `error_groups` ADD INDEX `idx_error_groups_status_last` (`status`, `last_seen`);
ALTER TABLE `error_groups` ADD INDEX `idx_error_groups_error_type` (`error_type`);