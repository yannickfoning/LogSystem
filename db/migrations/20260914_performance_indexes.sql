-- Migration: Performance Indexes (idempotent, compatible ANSI_QUOTES)
-- Les chaines SQL n'utilisent que des apostrophes ; aucun guillemet double.

SET @i = (SELECT COUNT(*) FROM information_schema.statistics
          WHERE table_schema = DATABASE() AND table_name = 'logs' AND index_name = 'idx_user_level_ts');
SET @sql = IF(@i = 0,
  'ALTER TABLE logs ADD INDEX `idx_user_level_ts` (`user_id`, `log_level`, `timestamp` DESC)',
  'SELECT 1 AS noop');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @i = (SELECT COUNT(*) FROM information_schema.statistics
          WHERE table_schema = DATABASE() AND table_name = 'logs' AND index_name = 'idx_user_error_type_ts');
SET @sql = IF(@i = 0,
  'ALTER TABLE logs ADD INDEX `idx_user_error_type_ts` (`user_id`, `error_type`, `timestamp` DESC)',
  'SELECT 1 AS noop');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @i = (SELECT COUNT(*) FROM information_schema.statistics
          WHERE table_schema = DATABASE() AND table_name = 'logs' AND index_name = 'idx_user_fingerprint_ts');
SET @sql = IF(@i = 0,
  'ALTER TABLE logs ADD INDEX `idx_user_fingerprint_ts` (`user_id`, `fingerprint`, `timestamp` DESC)',
  'SELECT 1 AS noop');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
