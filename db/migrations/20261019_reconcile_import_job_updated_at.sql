-- Restore the import job timestamp expected by the asynchronous worker.
-- Existing production databases can have migration history that predates this
-- field even though the current schema and worker depend on it.

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'import_jobs'
    AND column_name = 'updated_at'
);
SET @column_extra = (
  SELECT extra FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'import_jobs'
    AND column_name = 'updated_at'
  LIMIT 1
);
SET @sql = IF(
  @column_exists = 0,
  'ALTER TABLE import_jobs ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
  IF(LOWER(COALESCE(@column_extra, '')) NOT LIKE '%on update current_timestamp%',
    'ALTER TABLE import_jobs MODIFY COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
