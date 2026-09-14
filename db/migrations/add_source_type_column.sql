-- Add source_type column to logs table for tracking log ingestion methods
ALTER TABLE `logs` ADD COLUMN `source_type` VARCHAR(50) NULL AFTER `user_id`;
ALTER TABLE `logs` ADD COLUMN `ingested_realtime` TINYINT(1) DEFAULT 0 AFTER `source_type`;
CREATE INDEX idx_logs_source_type ON logs(source_type);
