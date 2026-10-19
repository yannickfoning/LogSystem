-- The import worker writes intermediate states that older production ENUMs
-- may not allow. Add every state defined by the current application schema.

SET @status_type = (
  SELECT column_type FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'import_jobs'
    AND column_name = 'status'
  LIMIT 1
);
SET @sql = IF(
  LOWER(COALESCE(@status_type, '')) NOT LIKE '%depositing%'
    OR LOWER(COALESCE(@status_type, '')) NOT LIKE '%extracting%'
    OR LOWER(COALESCE(@status_type, '')) NOT LIKE '%parsing%'
    OR LOWER(COALESCE(@status_type, '')) NOT LIKE '%counting%'
    OR LOWER(COALESCE(@status_type, '')) NOT LIKE '%inserting%',
  'ALTER TABLE import_jobs MODIFY COLUMN status ENUM(''pending'',''depositing'',''extracting'',''parsing'',''counting'',''inserting'',''processing'',''completed'',''failed'') DEFAULT ''pending''',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
