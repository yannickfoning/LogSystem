-- Existing production databases may have legacy migration history that says
-- these fields exist even when the live schema does not. Reconcile the log
-- import fields and dashboard trend fields used by current application code.

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'import_jobs' AND column_name = 'import_summary'
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE import_jobs ADD COLUMN import_summary JSON NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'logs' AND column_name = 'imported_at'
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE logs ADD COLUMN imported_at DATETIME DEFAULT CURRENT_TIMESTAMP', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'logs' AND column_name = 'source_server'
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE logs ADD COLUMN source_server VARCHAR(255) NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'logs' AND column_name = 'source_system'
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE logs ADD COLUMN source_system VARCHAR(255) NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'logs' AND column_name = 'source_type'
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE logs ADD COLUMN source_type VARCHAR(50) DEFAULT ''import''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'logs' AND column_name = 'ingested_realtime'
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE logs ADD COLUMN ingested_realtime TINYINT(1) DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'logs' AND column_name = 'client_ip'
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE logs ADD COLUMN client_ip VARCHAR(45) NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'logs' AND column_name = 'module'
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE logs ADD COLUMN module VARCHAR(100) NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'logs' AND column_name = 'error_type'
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE logs ADD COLUMN error_type VARCHAR(100) NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'logs' AND column_name = 'stack_trace'
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE logs ADD COLUMN stack_trace MEDIUMTEXT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'logs' AND column_name = 'target_user'
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE logs ADD COLUMN target_user VARCHAR(255) NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'logs' AND column_name = 'parser_format'
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE logs ADD COLUMN parser_format VARCHAR(50) NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'logs' AND column_name = 'timestamp_inferred'
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE logs ADD COLUMN timestamp_inferred TINYINT(1) DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'logs' AND column_name = 'classification_confidence'
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE logs ADD COLUMN classification_confidence DECIMAL(4,3) DEFAULT 0.500', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'logs' AND column_name = 'file_created_at'
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE logs ADD COLUMN file_created_at DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'logs' AND column_name = 'file_modified_at'
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE logs ADD COLUMN file_modified_at DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'logs' AND column_name = 'imported_by_user_id'
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE logs ADD COLUMN imported_by_user_id INT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'logs' AND column_name = 'log_source'
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE logs ADD COLUMN log_source VARCHAR(255) NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'logs' AND column_name = 'import_job_id'
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE logs ADD COLUMN import_job_id VARCHAR(36) NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
