SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `email` VARCHAR(255) UNIQUE NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `display_name` VARCHAR(100),
  `role` ENUM('user','admin') DEFAULT 'user',
  `is_active` TINYINT(1) DEFAULT 1,
  `last_login` DATETIME,
  `session_version` INT DEFAULT 0,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `logs`;
CREATE TABLE `logs` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `raw_log` TEXT,
  `timestamp` DATETIME NOT NULL,
  `created_time` TIME,
  `imported_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `timezone` VARCHAR(64),
  `log_level` ENUM('DEBUG','INFO','WARNING','ERROR','CRITICAL','FATAL') DEFAULT 'INFO',
  `source` VARCHAR(255),
  `source_server` VARCHAR(255),
  `service` VARCHAR(255),
  `message` TEXT,
  `normalized_message` TEXT,
  `event_type` VARCHAR(100) DEFAULT 'generic',
  `fingerprint` VARCHAR(40),
  `user_id` INT,
  `client_ip` VARCHAR(45),
  `module` VARCHAR(100),
  `error_type` VARCHAR(100),
  `stack_trace` MEDIUMTEXT,
  `target_user` VARCHAR(255),
  `parser_format` VARCHAR(50),
  `timestamp_inferred` TINYINT(1) DEFAULT 0,
  `classification_confidence` DECIMAL(4,3) DEFAULT 0.500,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_timestamp` (`timestamp`),
  INDEX `idx_log_level` (`log_level`),
  INDEX `idx_fingerprint` (`fingerprint`),
  INDEX `idx_source` (`source`),
  INDEX `idx_source_server` (`source_server`),
  INDEX `idx_service` (`service`),
  INDEX `idx_event_type` (`event_type`),
  INDEX `idx_error_type` (`error_type`),
  INDEX `idx_user_id` (`user_id`),
  UNIQUE KEY `idx_fingerprint_ts_user` (`fingerprint`, `timestamp`, `user_id`),
  FULLTEXT INDEX `ft_message` (`message`, `normalized_message`),
  INDEX `idx_user_ts` (`user_id`, `timestamp` DESC),
  INDEX `idx_user_level_ts` (`user_id`, `log_level`, `timestamp` DESC),
  INDEX `idx_user_error_type_ts` (`user_id`, `error_type`, `timestamp` DESC),
  INDEX `idx_user_fingerprint_ts` (`user_id`, `fingerprint`, `timestamp` DESC),
  CONSTRAINT `fk_logs_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `error_groups`;
CREATE TABLE `error_groups` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `fingerprint` VARCHAR(40) NOT NULL,
  `title` VARCHAR(500),
  `event_type` VARCHAR(100),
  `severity_max` VARCHAR(10),
  `occurrence_count` INT DEFAULT 1,
  `first_seen` DATETIME,
  `last_seen` DATETIME,
  `previous_seen` DATETIME,
  `resolved_at` DATETIME,
  `returned_at` DATETIME,
  `return_count` INT DEFAULT 0,
  `return_reason` TEXT,
  `source_server` VARCHAR(255),
  `service` VARCHAR(255),
  `error_type` VARCHAR(100),
  `status` ENUM('open','resolved','returned') DEFAULT 'open',
  `sample_log_id` BIGINT,
  `user_id` INT,
  UNIQUE KEY `idx_fingerprint_user` (`fingerprint`, `user_id`),
  INDEX `idx_error_groups_user_id` (`user_id`),
  INDEX `idx_error_groups_status_last` (`status`, `last_seen` DESC),
  INDEX `idx_error_groups_error_type` (`error_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `alert_rules`;
CREATE TABLE `alert_rules` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT,
  `condition_type` ENUM('level','count','fingerprint','threshold','silence','error_rate','level_count','import_status','log_inactivity','anomaly') NOT NULL,
  `condition_value` TEXT NOT NULL,
  `threshold_value` INT,
  `time_window_minutes` INT DEFAULT 60,
  `severity` ENUM('low','medium','high','critical') DEFAULT 'medium',
  `cooldown_minutes` INT DEFAULT 30,
  `is_active` TINYINT(1) DEFAULT 1,
  `created_by` INT,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_alert_rules_user` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `alerts`;
CREATE TABLE `alerts` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `rule_id` INT,
  `alert_type` VARCHAR(100),
  `severity` VARCHAR(20),
  `message` TEXT,
  `status` ENUM('new','read','dismissed') DEFAULT 'new',
  `metadata` JSON,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `read_at` DATETIME,
  `resolved_at` DATETIME NULL DEFAULT NULL,
  `user_id` INT,
  INDEX `idx_alerts_user_id` (`user_id`),
  INDEX `idx_alerts_resolved` (`resolved_at`),
  INDEX `idx_alerts_status` (`status`),
  INDEX `idx_alerts_user_status` (`user_id`, `status`),
  CONSTRAINT `fk_alerts_rule` FOREIGN KEY (`rule_id`) REFERENCES `alert_rules`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `import_jobs`;
CREATE TABLE `import_jobs` (
  `id` VARCHAR(36) PRIMARY KEY,
  `filename` VARCHAR(255),
  `status` ENUM('pending','processing','completed','failed') DEFAULT 'pending',
  `total_lines` INT DEFAULT 0,
  `processed_lines` INT DEFAULT 0,
  `error_count` INT DEFAULT 0,
  `error_message` TEXT,
  `skipped_lines` INT DEFAULT 0,
  `import_source` VARCHAR(255),
  `import_service` VARCHAR(255),
  `user_id` INT,
  `started_at` DATETIME,
  `completed_at` DATETIME,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_import_jobs_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `audit_log`;
CREATE TABLE `audit_log` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT,
  `user_email` VARCHAR(255),
  `action` VARCHAR(100),
  `resource_type` VARCHAR(100),
  `resource_id` VARCHAR(100),
  `details` TEXT,
  `ip_address` VARCHAR(45),
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_audit_user` (`user_id`),
  INDEX `idx_audit_action` (`action`),
  INDEX `idx_audit_resource` (`resource_type`),
  INDEX `idx_audit_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Watcher file offsets use a stable path hash as primary key to avoid indexing long paths.
DROP TABLE IF EXISTS `watch_offsets`;
CREATE TABLE `watch_offsets` (
  `path_hash` CHAR(64) PRIMARY KEY,
  `path` TEXT NOT NULL,
  `offset` BIGINT DEFAULT 0,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_watch_offsets_updated` (`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
