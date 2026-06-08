ALTER TABLE logs
  ADD COLUMN created_at_log DATETIME NULL,
  ADD COLUMN created_time_log VARCHAR(16) NULL,
  ADD COLUMN imported_at DATETIME NULL,
  ADD COLUMN imported_time VARCHAR(16) NULL,
  ADD COLUMN file_created_at DATETIME NULL,
  ADD COLUMN file_modified_at DATETIME NULL;

CREATE INDEX idx_logs_created_at_log ON logs(created_at_log);
CREATE INDEX idx_logs_imported_at ON logs(imported_at);
CREATE INDEX idx_logs_file_modified_at ON logs(file_modified_at);
