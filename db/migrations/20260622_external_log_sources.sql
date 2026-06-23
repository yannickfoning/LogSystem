-- External Log Sources table for Vercel-compatible log ingestion
-- Supports HTTP polling, webhooks, and external log sources

CREATE TABLE IF NOT EXISTS `external_log_sources` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(128) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `source_type` ENUM('http_json','http_lines','webhook','syslog') NOT NULL DEFAULT 'http_json',
  `endpoint_url` VARCHAR(512) DEFAULT NULL,
  `service_name` VARCHAR(128) DEFAULT NULL,
  `auth_token` VARCHAR(256) DEFAULT NULL,
  `custom_headers` JSON DEFAULT NULL,
  `poll_interval` ENUM('realtime','frequent','normal','slow') DEFAULT 'normal',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `user_id` INT UNSIGNED DEFAULT NULL,
  `last_poll_at` DATETIME DEFAULT NULL,
  `last_poll_status` VARCHAR(32) DEFAULT NULL,
  `last_error` TEXT DEFAULT NULL,
  `poll_count` INT UNSIGNED DEFAULT 0,
  `webhook_secret` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_external_sources_active` (`is_active`),
  KEY `idx_external_sources_user` (`user_id`),
  KEY `idx_external_sources_type` (`source_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Add external_source_id column to logs table if not exists
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'logs'
    AND COLUMN_NAME  = 'external_source_id'
);
SET @sql = IF(@col_exists = 0,
  "ALTER TABLE `logs` ADD COLUMN `external_source_id` INT UNSIGNED DEFAULT NULL AFTER `batch_id`",
  "SELECT 'logs.external_source_id already exists' AS msg"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add index for external_source_id
CREATE INDEX `idx_logs_external_source` ON `logs` (`external_source_id`);