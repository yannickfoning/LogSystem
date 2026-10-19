-- Reconcile runtime columns that may be absent even when older migration
-- records say they were applied. Every change is guarded and safe to rerun.

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'alerts' AND column_name = 'retry_count'
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE alerts ADD COLUMN retry_count INT DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'alerts' AND column_name = 'retry_last_attempt'
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE alerts ADD COLUMN retry_last_attempt DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'alerts' AND column_name = 'retry_next_attempt'
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE alerts ADD COLUMN retry_next_attempt DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'alerts' AND column_name = 'retry_error'
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE alerts ADD COLUMN retry_error TEXT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_exists = (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'alerts' AND index_name = 'idx_alerts_retry_next'
);
SET @sql = IF(@index_exists = 0,
  'ALTER TABLE alerts ADD INDEX idx_alerts_retry_next (retry_next_attempt)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'error_groups' AND column_name = 'solution_applied'
);
SET @column_type = (
  SELECT data_type FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'error_groups' AND column_name = 'solution_applied' LIMIT 1
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE error_groups ADD COLUMN solution_applied TEXT NULL',
  IF(@column_type IN ('tinyint', 'bit'),
    'ALTER TABLE error_groups MODIFY COLUMN solution_applied TEXT NULL', 'SELECT 1'));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'error_groups' AND column_name = 'solution_applied_at'
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE error_groups ADD COLUMN solution_applied_at DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'error_groups' AND column_name = 'solution_applied_by'
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE error_groups ADD COLUMN solution_applied_by INT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'import_jobs' AND column_name = 'total_files'
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE import_jobs ADD COLUMN total_files INT DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
