-- Add missing import tracking columns to logs table
-- These columns are required for proper import functionality

ALTER TABLE `logs` ADD COLUMN `imported_by_user_id` INT DEFAULT NULL AFTER `file_modified_at`;
ALTER TABLE `logs` ADD COLUMN `log_source` VARCHAR(255) DEFAULT NULL AFTER `imported_by_user_id`;
ALTER TABLE `logs` ADD COLUMN `import_job_id` VARCHAR(36) DEFAULT NULL AFTER `log_source`;

-- Add indexes for import tracking performance
ALTER TABLE `logs` ADD INDEX `idx_imported_by_user_id` (`imported_by_user_id`);
ALTER TABLE `logs` ADD INDEX `idx_import_job_id` (`import_job_id`);
ALTER TABLE `logs` ADD INDEX `idx_log_source` (`log_source`);