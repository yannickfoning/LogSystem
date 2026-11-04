-- Migration: Enhance Recommendations (idempotent, compatible ANSI_QUOTES)
-- Les chaines SQL n'utilisent que des apostrophes ; aucun guillemet double.

SET @c = (SELECT COUNT(*) FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = 'error_recommendations' AND column_name = 'frequency_threshold');
SET @sql = IF(@c = 0,
  'ALTER TABLE error_recommendations ADD COLUMN `frequency_threshold` INT DEFAULT 5',
  'SELECT 1 AS noop');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @c = (SELECT COUNT(*) FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = 'error_recommendations' AND column_name = 'recommendation_category');
SET @sql = IF(@c = 0,
  'ALTER TABLE error_recommendations ADD COLUMN `recommendation_category` VARCHAR(50) DEFAULT ''general''',
  'SELECT 1 AS noop');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @c = (SELECT COUNT(*) FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = 'error_recommendations' AND column_name = 'severity_level');
SET @sql = IF(@c = 0,
  'ALTER TABLE error_recommendations ADD COLUMN `severity_level` ENUM(''info'',''warning'',''critical'') DEFAULT ''info''',
  'SELECT 1 AS noop');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @c = (SELECT COUNT(*) FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = 'error_recommendations' AND column_name = 'tags');
SET @sql = IF(@c = 0,
  'ALTER TABLE error_recommendations ADD COLUMN `tags` JSON NULL',
  'SELECT 1 AS noop');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @i = (SELECT COUNT(*) FROM information_schema.statistics
          WHERE table_schema = DATABASE() AND table_name = 'error_recommendations' AND index_name = 'idx_category_priority');
SET @sql = IF(@i = 0,
  'ALTER TABLE error_recommendations ADD INDEX `idx_category_priority` (`recommendation_category`, `priority`)',
  'SELECT 1 AS noop');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @i = (SELECT COUNT(*) FROM information_schema.statistics
          WHERE table_schema = DATABASE() AND table_name = 'error_recommendations' AND index_name = 'idx_severity_frequency');
SET @sql = IF(@i = 0,
  'ALTER TABLE error_recommendations ADD INDEX `idx_severity_frequency` (`severity_level`, `frequency_threshold`)',
  'SELECT 1 AS noop');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

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
  INDEX `idx_occurrence` (`occurrence_count`),
  CONSTRAINT `fk_rec_freq_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rec_freq_rec` FOREIGN KEY (`recommendation_id`) REFERENCES `error_recommendations`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

UPDATE error_recommendations
SET recommendation_category = 'general', severity_level = 'info'
WHERE recommendation_category IS NULL OR severity_level IS NULL;
