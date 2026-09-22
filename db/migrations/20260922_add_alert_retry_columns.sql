-- Migration: Add alert retry tracking columns
-- Date: 2026-09-22
-- Description: Add retry tracking to alerts table for failed alert delivery

ALTER TABLE `alerts`
ADD COLUMN `retry_count` INT DEFAULT 0,
ADD COLUMN `retry_last_attempt` DATETIME NULL,
ADD COLUMN `retry_next_attempt` DATETIME NULL,
ADD COLUMN `retry_error` TEXT NULL,
ADD INDEX `idx_alerts_retry_next` (`retry_next_attempt`);
