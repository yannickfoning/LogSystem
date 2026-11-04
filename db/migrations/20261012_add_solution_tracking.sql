-- Migration: Add Solution Tracking (idempotent, compatible ANSI_QUOTES)
-- Les chaines SQL n'utilisent que des apostrophes ; aucun guillemet double.

SET @c = (SELECT COUNT(*) FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = 'error_groups' AND column_name = 'solution_applied');
SET @sql = IF(@c = 0,
  'ALTER TABLE error_groups ADD COLUMN `solution_applied` TEXT NULL',
  'SELECT 1 AS noop');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @c = (SELECT COUNT(*) FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = 'error_groups' AND column_name = 'solution_applied_at');
SET @sql = IF(@c = 0,
  'ALTER TABLE error_groups ADD COLUMN `solution_applied_at` DATETIME NULL',
  'SELECT 1 AS noop');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @c = (SELECT COUNT(*) FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = 'error_groups' AND column_name = 'solution_applied_by');
SET @sql = IF(@c = 0,
  'ALTER TABLE error_groups ADD COLUMN `solution_applied_by` INT NULL',
  'SELECT 1 AS noop');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk = (SELECT COUNT(*) FROM information_schema.table_constraints
           WHERE table_schema = DATABASE() AND table_name = 'error_groups'
           AND constraint_name = 'fk_error_groups_solution_applied_by');
SET @sql = IF(@fk = 0,
  'ALTER TABLE error_groups ADD CONSTRAINT `fk_error_groups_solution_applied_by` FOREIGN KEY (`solution_applied_by`) REFERENCES `users`(`id`) ON DELETE SET NULL',
  'SELECT 1 AS noop');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @c = (SELECT COUNT(*) FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = 'error_recommendations' AND column_name = 'has_solution');
SET @sql = IF(@c = 0,
  'ALTER TABLE error_recommendations ADD COLUMN `has_solution` TINYINT(1) DEFAULT 0',
  'SELECT 1 AS noop');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @c = (SELECT COUNT(*) FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = 'error_recommendations' AND column_name = 'solution_details');
SET @sql = IF(@c = 0,
  'ALTER TABLE error_recommendations ADD COLUMN `solution_details` TEXT NULL',
  'SELECT 1 AS noop');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @i = (SELECT COUNT(*) FROM information_schema.statistics
          WHERE table_schema = DATABASE() AND table_name = 'error_recommendations' AND index_name = 'idx_has_solution');
SET @sql = IF(@i = 0,
  'ALTER TABLE error_recommendations ADD INDEX `idx_has_solution` (`has_solution`)',
  'SELECT 1 AS noop');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @i = (SELECT COUNT(*) FROM information_schema.statistics
          WHERE table_schema = DATABASE() AND table_name = 'error_groups' AND index_name = 'idx_solution_applied');
SET @sql = IF(@i = 0,
  'ALTER TABLE error_groups ADD INDEX `idx_solution_applied` (`solution_applied_at`)',
  'SELECT 1 AS noop');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
