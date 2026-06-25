-- Migration: Add resolved_at column to alerts table
-- This column is used to track when alerts are resolved/dismissed

ALTER TABLE `alerts` ADD COLUMN `resolved_at` DATETIME NULL DEFAULT NULL AFTER `read_at`;

-- Create index for filtering unresolved alerts
CREATE INDEX `idx_alerts_resolved` ON `alerts`(`resolved_at`);
