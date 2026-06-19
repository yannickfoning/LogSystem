-- Migration: Add skipped_lines, import_source, import_service to import_jobs
-- Run this if upgrading from V4 to V5
ALTER TABLE `import_jobs`
  ADD COLUMN IF NOT EXISTS `skipped_lines` INT DEFAULT 0 AFTER `error_message`,
  ADD COLUMN IF NOT EXISTS `import_source` VARCHAR(255) AFTER `skipped_lines`,
  ADD COLUMN IF NOT EXISTS `import_service` VARCHAR(255) AFTER `import_source`;

-- Migration: Add watch_offsets table if not exists (required by watcherService)
CREATE TABLE IF NOT EXISTS `watch_offsets` (
  `path_hash` CHAR(64) PRIMARY KEY,
  `path` TEXT NOT NULL,
  `offset` BIGINT DEFAULT 0,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
