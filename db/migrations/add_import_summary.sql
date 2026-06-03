-- FIX 2b: Add import_summary and skipped_lines columns to import_jobs table
-- These columns store quality metrics and summary information for import jobs

ALTER TABLE import_jobs 
  ADD COLUMN IF NOT EXISTS import_summary JSON NULL,
  ADD COLUMN IF NOT EXISTS skipped_lines INT DEFAULT 0;
