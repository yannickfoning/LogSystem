-- Migration: Performance Optimization Indexes
-- Date: 2026-09-14
-- Description: Add composite indexes for optimized query performance based on EXPLAIN analysis

-- Add composite index for error_groups to optimize top-errors query
-- Current query: WHERE user_id = ? AND status IN ('open', 'returned') ORDER BY occurrence_count DESC
SET @index_exists = (SELECT COUNT(*) FROM information_schema.statistics 
                     WHERE table_schema = DATABASE() AND table_name = 'error_groups' AND index_name = 'idx_user_status_occurrence');

SET @sql = IF(@index_exists = 0,
  'ALTER TABLE error_groups ADD INDEX `idx_user_status_occurrence` (`user_id`, `status`, `occurrence_count` DESC)',
  'SELECT "Index idx_user_status_occurrence already exists" AS message');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add composite index for logs to optimize pattern analysis query
-- Current query: WHERE user_id = ? AND timestamp >= DATE_SUB(NOW(), INTERVAL 24 HOUR) AND log_level IN ('ERROR', 'CRITICAL', 'FATAL')
SET @index_exists = (SELECT COUNT(*) FROM information_schema.statistics 
                     WHERE table_schema = DATABASE() AND table_name = 'logs' AND index_name = 'idx_user_level_time_filtered');

SET @sql = IF(@index_exists = 0,
  'ALTER TABLE logs ADD INDEX `idx_user_level_time_filtered` (`user_id`, `log_level`, `timestamp`)',
  'SELECT "Index idx_user_level_time_filtered already exists" AS message');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add composite index for recommendation_frequency to optimize by-frequency query
-- Current query: WHERE user_id = ? AND occurrence_count >= ? ORDER BY occurrence_count DESC
SET @index_exists = (SELECT COUNT(*) FROM information_schema.statistics 
                     WHERE table_schema = DATABASE() AND table_name = 'recommendation_frequency' AND index_name = 'idx_user_occurrence_level');

SET @sql = IF(@index_exists = 0,
  'ALTER TABLE recommendation_frequency ADD INDEX `idx_user_occurrence_level` (`user_id`, `occurrence_count` DESC, `log_level`)',
  'SELECT "Index idx_user_occurrence_level already exists" AS message');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;