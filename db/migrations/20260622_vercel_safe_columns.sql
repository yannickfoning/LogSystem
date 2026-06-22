-- Safe migration: add missing columns on existing Aiven DB without breaking anything
-- All statements use IF NOT EXISTS / IGNORE to be fully idempotent

-- 1. audit_log.status column (added in 20260620 but may have been skipped)
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'audit_log'
    AND COLUMN_NAME  = 'status'
);
SET @sql = IF(@col_exists = 0,
  "ALTER TABLE `audit_log` ADD COLUMN `status` VARCHAR(20) DEFAULT 'success' AFTER `ip_address`",
  "SELECT 'audit_log.status already exists' AS msg"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Index on status (safe: CREATE INDEX IF NOT EXISTS not supported in MySQL 5.x, use try/ignore)
CREATE INDEX `idx_audit_status` ON `audit_log` (`status`);
-- ^ Will fail silently if already exists; migrationRunner ignores ER_DUP_KEYNAME

-- 2. Ensure logs.event_timestamp exists (needed by trends query)
SET @col2 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'logs'
    AND COLUMN_NAME  = 'event_timestamp'
);
SET @sql2 = IF(@col2 = 0,
  "ALTER TABLE `logs` ADD COLUMN `event_timestamp` DATETIME DEFAULT NULL AFTER `timestamp`",
  "SELECT 'logs.event_timestamp already exists' AS msg"
);
PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;

-- 3. Ensure logs.imported_at exists
SET @col3 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'logs'
    AND COLUMN_NAME  = 'imported_at'
);
SET @sql3 = IF(@col3 = 0,
  "ALTER TABLE `logs` ADD COLUMN `imported_at` DATETIME DEFAULT NULL AFTER `created_at`",
  "SELECT 'logs.imported_at already exists' AS msg"
);
PREPARE stmt3 FROM @sql3; EXECUTE stmt3; DEALLOCATE PREPARE stmt3;

-- 4. Ensure anomalies table exists (for anomaliesService.js)
CREATE TABLE IF NOT EXISTS `anomalies` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `log_id`       INT UNSIGNED DEFAULT NULL,
  `user_id`      INT UNSIGNED DEFAULT NULL,
  `fingerprint`  VARCHAR(64)  DEFAULT NULL,
  `anomaly_type` VARCHAR(64)  NOT NULL DEFAULT 'spike',
  `severity`     VARCHAR(20)  NOT NULL DEFAULT 'medium',
  `score`        FLOAT        DEFAULT NULL,
  `description`  TEXT         DEFAULT NULL,
  `details`      JSON         DEFAULT NULL,
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_anomalies_created` (`created_at`),
  KEY `idx_anomalies_severity` (`severity`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. Ensure error_groups table exists (for top-errors + analysis routes)
CREATE TABLE IF NOT EXISTS `error_groups` (
  `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `fingerprint`      VARCHAR(64)  NOT NULL,
  `title`            VARCHAR(512) DEFAULT NULL,
  `event_type`       VARCHAR(128) DEFAULT NULL,
  `error_type`       VARCHAR(256) DEFAULT NULL,
  `severity_max`     VARCHAR(20)  DEFAULT 'ERROR',
  `occurrence_count` INT UNSIGNED NOT NULL DEFAULT 1,
  `first_seen`       DATETIME     DEFAULT NULL,
  `last_seen`        DATETIME     DEFAULT NULL,
  `previous_seen`    DATETIME     DEFAULT NULL,
  `returned_at`      DATETIME     DEFAULT NULL,
  `return_reason`    VARCHAR(256) DEFAULT NULL,
  `return_count`     INT UNSIGNED DEFAULT 0,
  `source_server`    VARCHAR(256) DEFAULT NULL,
  `service`          VARCHAR(128) DEFAULT NULL,
  `status`           ENUM('open','resolved','ignored','returned') NOT NULL DEFAULT 'open',
  `sample_log_id`    INT UNSIGNED DEFAULT NULL,
  `user_id`          INT UNSIGNED DEFAULT NULL,
  `is_global`        TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_eg_fingerprint` (`fingerprint`),
  KEY `idx_eg_status` (`status`),
  KEY `idx_eg_last_seen` (`last_seen`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
