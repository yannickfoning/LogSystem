-- Migration corrective pour ajouter les colonnes manquantes
-- Corrige les erreurs d'import, alertes et top errors

-- Ajouter retry_count à la table alerts
SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'alerts'
    AND column_name = 'retry_count'
);
SET @sql = IF(
  @column_exists = 0,
  'ALTER TABLE alerts ADD COLUMN retry_count INT DEFAULT 0 AFTER status',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Ajouter solution_applied à la table error_groups
SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'error_groups'
    AND column_name = 'solution_applied'
);
SET @sql = IF(
  @column_exists = 0,
  'ALTER TABLE error_groups ADD COLUMN solution_applied TINYINT(1) DEFAULT 0 AFTER return_reason',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Ajouter total_files à la table import_jobs
SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'import_jobs'
    AND column_name = 'total_files'
);
SET @sql = IF(
  @column_exists = 0,
  'ALTER TABLE import_jobs ADD COLUMN total_files INT DEFAULT 0',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
