ALTER TABLE users
  MODIFY COLUMN role ENUM('user','analyst','admin') DEFAULT 'user';

ALTER TABLE import_jobs ADD COLUMN file_size BIGINT NULL;
ALTER TABLE import_jobs ADD COLUMN file_hash VARCHAR(64) NULL;
ALTER TABLE import_jobs ADD COLUMN source_directory VARCHAR(1024) NULL;
ALTER TABLE import_jobs ADD COLUMN import_ip_address VARCHAR(45) NULL;
ALTER TABLE import_jobs ADD COLUMN import_summary JSON NULL;
