-- Migration corrective pour déploiement Render
-- Ajoute les colonnes manquantes après échec de migrations précédentes

-- Ajouter la colonne log_format à error_recommendations
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

-- Ajouter l'index sur log_format
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

-- Étendre condition_type dans alert_rules pour inclure 'log_type'
SET @condition_type_check = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'alert_rules'
    AND column_name = 'condition_type'
    AND column_type LIKE '%log_type%'
);
SET @sql = IF(
  @condition_type_check = 0,
  'ALTER TABLE alert_rules MODIFY condition_type ENUM(''level'',''count'',''fingerprint'',''threshold'',''silence'',''error_rate'',''level_count'',''import_status'',''log_inactivity'',''anomaly'',''log_type'') NOT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
