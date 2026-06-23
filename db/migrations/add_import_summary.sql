-- FIX 2b: Add import_summary and skipped_lines columns to import_jobs table
-- These columns store quality metrics and summary information for import jobs

-- MySQL 5.7/Aiven do not support ADD COLUMN IF NOT EXISTS; duplicate columns
-- are ignored by the migration runner.
ALTER TABLE import_jobs ADD COLUMN import_summary JSON NULL;
ALTER TABLE import_jobs ADD COLUMN skipped_lines INT DEFAULT 0;
