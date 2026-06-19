-- Migration: Add skipped_lines, import_source, import_service to import_jobs
-- Run this if upgrading from V4 to V5
-- MySQL 5.7/Aiven do not support ADD COLUMN IF NOT EXISTS; duplicate columns
-- are ignored by the migration runner.
ALTER TABLE `import_jobs` ADD COLUMN `skipped_lines` INT DEFAULT 0 AFTER `error_message`;
ALTER TABLE `import_jobs` ADD COLUMN `import_source` VARCHAR(255) AFTER `skipped_lines`;
ALTER TABLE `import_jobs` ADD COLUMN `import_service` VARCHAR(255) AFTER `import_source`;

-- Migration: Add watch_offsets table if not exists (required by watcherService)
CREATE TABLE IF NOT EXISTS `watch_offsets` (
  `path_hash` CHAR(64) PRIMARY KEY,
  `path` TEXT NOT NULL,
  `offset` BIGINT DEFAULT 0,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
