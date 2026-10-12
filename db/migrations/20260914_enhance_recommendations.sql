-- Migration: Enhance Recommendations Table for Production Optimization
-- Date: 2026-09-14
-- Description: Add frequency tracking, categorization, and severity levels to recommendations

-- Enhance error_recommendations table with new columns (MySQL 8.0 compatible syntax)
SET @column_exists = (SELECT COUNT(*) FROM information_schema.columns
                     WHERE table_schema = DATABASE() AND table_name = 'error_recommendations' AND column_name = 'frequency_threshold');

SET @sql = IF(@column_exists = 0,
  'ALTER TABLE error_recommendations ADD COLUMN `frequency_threshold` INT DEFAULT 5 COMMENT ''Nombre minimum d''occurrences pour déclencher la recommandation''',
  'SELECT "Column frequency_threshold already exists" AS message');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (SELECT COUNT(*) FROM information_schema.columns
                     WHERE table_schema = DATABASE() AND table_name = 'error_recommendations' AND column_name = 'recommendation_category');

SET @sql = IF(@column_exists = 0,
  'ALTER TABLE error_recommendations ADD COLUMN `recommendation_category` VARCHAR(50) DEFAULT ''general'' COMMENT ''Catégorie: database, authentication, performance, memory, network''',
  'SELECT "Column recommendation_category already exists" AS message');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (SELECT COUNT(*) FROM information_schema.columns
                     WHERE table_schema = DATABASE() AND table_name = 'error_recommendations' AND column_name = 'severity_level');

SET @sql = IF(@column_exists = 0,
  'ALTER TABLE error_recommendations ADD COLUMN `severity_level` ENUM(''info'',''warning'',''critical'') DEFAULT ''info''',
  'SELECT "Column severity_level already exists" AS message');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (SELECT COUNT(*) FROM information_schema.columns
                     WHERE table_schema = DATABASE() AND table_name = 'error_recommendations' AND column_name = 'tags');

SET @sql = IF(@column_exists = 0,
  'ALTER TABLE error_recommendations ADD COLUMN `tags` JSON COMMENT ''Tags pour filtrage rapide''',
  'SELECT "Column tags already exists" AS message');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add indexes for performance (if they don't exist)
SET @index_exists = (SELECT COUNT(*) FROM information_schema.statistics 
                     WHERE table_schema = DATABASE() AND table_name = 'error_recommendations' AND index_name = 'idx_category_priority');

SET @sql = IF(@index_exists = 0,
  'ALTER TABLE error_recommendations ADD INDEX `idx_category_priority` (`recommendation_category`, `priority` DESC)',
  'SELECT "Index idx_category_priority already exists" AS message');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_exists = (SELECT COUNT(*) FROM information_schema.statistics 
                     WHERE table_schema = DATABASE() AND table_name = 'error_recommendations' AND index_name = 'idx_severity_frequency');

SET @sql = IF(@index_exists = 0,
  'ALTER TABLE error_recommendations ADD INDEX `idx_severity_frequency` (`severity_level`, `frequency_threshold`)',
  'SELECT "Index idx_severity_frequency already exists" AS message');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Create recommendation_frequency table for tracking error patterns
CREATE TABLE IF NOT EXISTS `recommendation_frequency` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `error_type` VARCHAR(100) NOT NULL,
  `log_level` VARCHAR(20),
  `occurrence_count` INT DEFAULT 0,
  `last_triggered` DATETIME,
  `recommendation_id` INT,
  `user_id` INT,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `idx_error_user` (`error_type`, `user_id`),
  INDEX `idx_occurrence` (`occurrence_count` DESC),
  CONSTRAINT `fk_rec_freq_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rec_freq_rec` FOREIGN KEY (`recommendation_id`) REFERENCES `error_recommendations`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Update existing recommendations with default categories (only if columns exist)
SET @column_exists = (SELECT COUNT(*) FROM information_schema.columns
                     WHERE table_schema = DATABASE() AND table_name = 'error_recommendations' AND column_name = 'recommendation_category');

SET @sql = IF(@column_exists > 0,
  'UPDATE error_recommendations SET recommendation_category = ''general'', severity_level = ''info'' WHERE recommendation_category IS NULL',
  'SELECT "Skipping update - columns do not exist" AS message');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;