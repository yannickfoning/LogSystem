-- Migration 002: Platform improvements (date fields, indexes)

ALTER TABLE `logs` ADD COLUMN `file_created_at` DATETIME NULL COMMENT 'File birthtime from fs.stat';
ALTER TABLE `logs` ADD COLUMN `file_modified_at` DATETIME NULL COMMENT 'File mtime from fs.stat';

ALTER TABLE `logs` ADD INDEX `idx_imported_at` (`imported_at`);
ALTER TABLE `logs` ADD INDEX `idx_file_created` (`file_created_at`);
