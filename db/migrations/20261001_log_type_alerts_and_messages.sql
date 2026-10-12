-- Add matching metadata for format-specific alert rules.

ALTER TABLE alert_rules
  MODIFY condition_type ENUM(
    'level','count','fingerprint','threshold','silence','error_rate',
    'level_count','import_status','log_inactivity','anomaly','log_type'
  ) NOT NULL;

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'error_recommendations'
    AND column_name = 'log_format'
);
SET @sql = IF(
  @column_exists = 0,
  'ALTER TABLE error_recommendations ADD COLUMN log_format VARCHAR(50) NULL AFTER log_level',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_exists = (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'error_recommendations'
    AND index_name = 'idx_recommendation_log_format'
);
SET @sql = IF(
  @index_exists = 0,
  'CREATE INDEX idx_recommendation_log_format ON error_recommendations (log_format, is_active, priority)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

