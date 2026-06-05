-- Migration 002: Platform improvements (date fields, indexes, audit enhancements)
SET FOREIGN_KEY_CHECKS = 0;

-- 4. Log date fields
ALTER TABLE `logs`
  ADD COLUMN IF NOT EXISTS `file_created_at` DATETIME NULL AFTER `created_at`,
  ADD COLUMN IF NOT EXISTS `file_modified_at` DATETIME NULL AFTER `file_created_at`;

-- Additional indexes for performance (point 10)
ALTER TABLE `logs`
  ADD INDEX IF NOT EXISTS `idx_imported_at` (`imported_at`),
  ADD INDEX IF NOT EXISTS `idx_file_created` (`file_created_at`);

SET FOREIGN_KEY_CHECKS = 1;
