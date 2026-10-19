-- Keep the production ENUM aligned with the levels accepted by normalizeLevel().
SET @log_level_type = (
  SELECT column_type FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'logs'
    AND column_name = 'log_level'
  LIMIT 1
);
SET @sql = IF(
  LOWER(COALESCE(@log_level_type, '')) NOT LIKE '%trace%'
    OR LOWER(COALESCE(@log_level_type, '')) NOT LIKE '%security%',
  'ALTER TABLE logs MODIFY COLUMN log_level ENUM(''TRACE'',''DEBUG'',''INFO'',''WARNING'',''ERROR'',''CRITICAL'',''FATAL'',''SECURITY'') DEFAULT ''INFO''',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
