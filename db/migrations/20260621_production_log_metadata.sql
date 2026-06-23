-- LogSystem v7 — Canonical log metadata for production
-- event_timestamp, source_system, main_service, hostname, log_origin

ALTER TABLE `logs` ADD COLUMN `event_timestamp` DATETIME NULL;
ALTER TABLE `logs` ADD COLUMN `source_system` VARCHAR(255) NULL;
ALTER TABLE `logs` ADD COLUMN `main_service` VARCHAR(255) NULL;
ALTER TABLE `logs` ADD COLUMN `hostname` VARCHAR(255) NULL;
ALTER TABLE `logs` ADD COLUMN `log_origin` VARCHAR(255) NULL;

-- Backfill from existing columns (retrocompat)
UPDATE `logs` SET `event_timestamp` = `timestamp` WHERE `event_timestamp` IS NULL AND `timestamp` IS NOT NULL;
UPDATE `logs` SET `hostname` = COALESCE(`source_server`, `source`) WHERE `hostname` IS NULL;
UPDATE `logs` SET `source_system` = COALESCE(`log_source`, `source`, `source_server`) WHERE `source_system` IS NULL;
UPDATE `logs` SET `main_service` = COALESCE(`service`, 'Application') WHERE `main_service` IS NULL;
UPDATE `logs` SET `log_origin` = COALESCE(`source_type`, 'legacy') WHERE `log_origin` IS NULL;

-- Performance indexes for search/filter/dashboard
CREATE INDEX idx_logs_event_timestamp ON logs(event_timestamp);
CREATE INDEX idx_logs_source_system ON logs(source_system);
CREATE INDEX idx_logs_main_service ON logs(main_service);
CREATE INDEX idx_logs_hostname ON logs(hostname);
CREATE INDEX idx_logs_log_origin ON logs(log_origin);
CREATE INDEX idx_user_event_ts ON logs(user_id, event_timestamp DESC);
CREATE INDEX idx_user_main_service_ts ON logs(user_id, main_service, event_timestamp DESC);
