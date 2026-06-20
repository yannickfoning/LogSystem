-- recordAudit() accepted a `status` param (default 'success') that was never
-- persisted: audit_log had no status column, so success/failure was silently
-- dropped at the top level (it only survived inside the JSON `details` blob
-- written by auditMiddleware, which is not queryable/indexable).
ALTER TABLE `audit_log` ADD COLUMN `status` VARCHAR(20) DEFAULT 'success' AFTER `ip_address`;
CREATE INDEX `idx_audit_status` ON `audit_log` (`status`);
