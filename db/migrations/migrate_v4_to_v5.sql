-- MIGRATION V4 → V5 (Aiven MySQL compatible — no IF NOT EXISTS on ALTER/CREATE INDEX)

ALTER TABLE `alerts`
  ADD COLUMN `resolved_at` DATETIME NULL DEFAULT NULL AFTER `read_at`;

ALTER TABLE `alerts` ADD INDEX `idx_alerts_resolved` (`resolved_at`);

ALTER TABLE `import_jobs`
  ADD COLUMN `skipped_lines`   INT          DEFAULT 0   AFTER `error_message`,
  ADD COLUMN `import_source`   VARCHAR(255)             AFTER `skipped_lines`,
  ADD COLUMN `import_service`  VARCHAR(255)             AFTER `import_source`;

CREATE TABLE IF NOT EXISTS `watch_offsets` (
  `path`       VARCHAR(1024) PRIMARY KEY,
  `offset`     BIGINT       DEFAULT 0,
  `updated_at` DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

UPDATE `alert_rules`
SET `created_by` = (SELECT `id` FROM `users` WHERE `role` = 'admin' AND `is_active` = 1 ORDER BY `id` ASC LIMIT 1)
WHERE `created_by` IS NULL;

ALTER TABLE `logs` ADD INDEX `idx_logs_user_timestamp` (`user_id`, `timestamp`);
ALTER TABLE `logs` ADD INDEX `idx_logs_fingerprint` (`fingerprint`);
ALTER TABLE `logs` ADD INDEX `idx_logs_level` (`log_level`);
ALTER TABLE `logs` ADD INDEX `idx_logs_timestamp` (`timestamp`);
