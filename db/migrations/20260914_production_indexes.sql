-- Migration: Production Performance Indexes
-- Date: 2026-09-14
-- Description: Add indexes for optimized queries on error_groups, logs, and recommendation_frequency

-- Index for error_groups to optimize top-errors queries
SET @index_exists = (SELECT COUNT(*) FROM information_schema.statistics 
                     WHERE table_schema = DATABASE() AND table_name = 'error_groups' AND index_name = 'idx_occurrence_desc');

SET @index_sql = IF(@index_exists = 0,
  'ALTER TABLE error_groups ADD INDEX `idx_occurrence_desc` (`occurrence_count` DESC)',
  'SELECT ''Index idx_occurrence_desc already exists'' AS message');

PREPARE stmt FROM @index_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_exists = (SELECT COUNT(*) FROM information_schema.statistics 
                     WHERE table_schema = DATABASE() AND table_name = 'error_groups' AND index_name = 'idx_status_occurrence');

SET @index_sql = IF(@index_exists = 0,
  'ALTER TABLE error_groups ADD INDEX `idx_status_occurrence` (`status`, `occurrence_count` DESC)',
  'SELECT ''Index idx_status_occurrence already exists'' AS message');

PREPARE stmt FROM @index_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Composite indexes for logs to optimize dashboard queries
SET @index_exists = (SELECT COUNT(*) FROM information_schema.statistics 
                     WHERE table_schema = DATABASE() AND table_name = 'logs' AND index_name = 'idx_user_level_time');

SET @index_sql = IF(@index_exists = 0,
  'ALTER TABLE logs ADD INDEX `idx_user_level_time` (`user_id`, `log_level`, `timestamp` DESC)',
  'SELECT ''Index idx_user_level_time already exists'' AS message');

PREPARE stmt FROM @index_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_exists = (SELECT COUNT(*) FROM information_schema.statistics 
                     WHERE table_schema = DATABASE() AND table_name = 'logs' AND index_name = 'idx_user_error_time');

SET @index_sql = IF(@index_exists = 0,
  'ALTER TABLE logs ADD INDEX `idx_user_error_time` (`user_id`, `error_type`, `timestamp` DESC)',
  'SELECT ''Index idx_user_error_time already exists'' AS message');

PREPARE stmt FROM @index_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_exists = (SELECT COUNT(*) FROM information_schema.statistics 
                     WHERE table_schema = DATABASE() AND table_name = 'logs' AND index_name = 'idx_fingerprint_user_time');

SET @index_sql = IF(@index_exists = 0,
  'ALTER TABLE logs ADD INDEX `idx_fingerprint_user_time` (`fingerprint`, `user_id`, `timestamp` DESC)',
  'SELECT ''Index idx_fingerprint_user_time already exists'' AS message');

PREPARE stmt FROM @index_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Index for recommendation_frequency table
SET @index_exists = (SELECT COUNT(*) FROM information_schema.statistics 
                     WHERE table_schema = DATABASE() AND table_name = 'recommendation_frequency' AND index_name = 'idx_user_occurrence');

SET @index_sql = IF(@index_exists = 0,
  'ALTER TABLE recommendation_frequency ADD INDEX `idx_user_occurrence` (`user_id`, `occurrence_count` DESC)',
  'SELECT ''Index idx_user_occurrence already exists'' AS message');

PREPARE stmt FROM @index_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_exists = (SELECT COUNT(*) FROM information_schema.statistics 
                     WHERE table_schema = DATABASE() AND table_name = 'recommendation_frequency' AND index_name = 'idx_category_count');

SET @index_sql = IF(@index_exists = 0,
  'ALTER TABLE recommendation_frequency ADD INDEX `idx_category_count` (`error_type`, `occurrence_count` DESC)',
  'SELECT ''Index idx_category_count already exists'' AS message');

PREPARE stmt FROM @index_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add index for logs on event_timestamp for time-based queries
SET @column_exists = (SELECT COUNT(*) FROM information_schema.columns 
                     WHERE table_schema = DATABASE() AND table_name = 'logs' AND column_name = 'event_timestamp');

SET @index_sql = IF(@column_exists > 0,
  'ALTER TABLE logs ADD INDEX `idx_event_timestamp` (`event_timestamp` DESC)',
  'SELECT ''Column event_timestamp does not exist, skipping index'' AS message');

PREPARE stmt FROM @index_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;