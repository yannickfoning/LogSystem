-- Migration: Add Solution Tracking for Recommendations
-- Date: 2026-10-12
-- Description: Track when logs are resolved and what solution was used

-- Add solution tracking to error_groups table
SET @column_exists = (SELECT COUNT(*) FROM information_schema.columns
                     WHERE table_schema = DATABASE() AND table_name = 'error_groups' AND column_name = 'solution_applied');

SET @sql = IF(@column_exists = 0,
  'ALTER TABLE error_groups ADD COLUMN `solution_applied` TEXT COMMENT ''Solution or fix applied to resolve this error group''',
  'SELECT "Column solution_applied already exists" AS message');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (SELECT COUNT(*) FROM information_schema.columns
                     WHERE table_schema = DATABASE() AND table_name = 'error_groups' AND column_name = 'solution_applied_at');

SET @sql = IF(@column_exists = 0,
  'ALTER TABLE error_groups ADD COLUMN `solution_applied_at` DATETIME COMMENT ''When the solution was applied''',
  'SELECT "Column solution_applied_at already exists" AS message');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (SELECT COUNT(*) FROM information_schema.columns
                     WHERE table_schema = DATABASE() AND table_name = 'error_groups' AND column_name = 'solution_applied_by');

SET @sql = IF(@column_exists = 0,
  'ALTER TABLE error_groups ADD COLUMN `solution_applied_by` INT COMMENT ''User who applied the solution''',
  'SELECT "Column solution_applied_by already exists" AS message');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add foreign key for solution_applied_by
SET @fk_exists = (SELECT COUNT(*) FROM information_schema.table_constraints
                  WHERE table_schema = DATABASE() AND table_name = 'error_groups' 
                  AND constraint_name = 'fk_error_groups_solution_applied_by');

SET @sql = IF(@fk_exists = 0,
  'ALTER TABLE error_groups ADD CONSTRAINT `fk_error_groups_solution_applied_by` FOREIGN KEY (`solution_applied_by`) REFERENCES `users`(`id`) ON DELETE SET NULL',
  'SELECT "Foreign key fk_error_groups_solution_applied_by already exists" AS message');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add flag to error_recommendations to mark if solution exists
SET @column_exists = (SELECT COUNT(*) FROM information_schema.columns
                     WHERE table_schema = DATABASE() AND table_name = 'error_recommendations' AND column_name = 'has_solution');

SET @sql = IF(@column_exists = 0,
  'ALTER TABLE error_recommendations ADD COLUMN `has_solution` TINYINT(1) DEFAULT 0 COMMENT ''Whether a known solution exists for this recommendation''',
  'SELECT "Column has_solution already exists" AS message');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (SELECT COUNT(*) FROM information_schema.columns
                     WHERE table_schema = DATABASE() AND table_name = 'error_recommendations' AND column_name = 'solution_details');

SET @sql = IF(@column_exists = 0,
  'ALTER TABLE error_recommendations ADD COLUMN `solution_details` TEXT COMMENT ''Detailed solution steps if has_solution = 1''',
  'SELECT "Column solution_details already exists" AS message');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add index for filtering recommendations with solutions
SET @index_exists = (SELECT COUNT(*) FROM information_schema.statistics 
                     WHERE table_schema = DATABASE() AND table_name = 'error_recommendations' AND index_name = 'idx_has_solution');

SET @sql = IF(@index_exists = 0,
  'ALTER TABLE error_recommendations ADD INDEX `idx_has_solution` (`has_solution`)',
  'SELECT "Index idx_has_solution already exists" AS message');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add index for filtering resolved error groups
SET @index_exists = (SELECT COUNT(*) FROM information_schema.statistics 
                     WHERE table_schema = DATABASE() AND table_name = 'error_groups' AND index_name = 'idx_solution_applied');

SET @sql = IF(@index_exists = 0,
  'ALTER TABLE error_groups ADD INDEX `idx_solution_applied` (`solution_applied_at`)',
  'SELECT "Index idx_solution_applied already exists" AS message');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
