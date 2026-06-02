-- ============================================================
-- MIGRATION V4 → V5  (LogSystem)
-- A appliquer sur une base V4 existante
-- Ordre d'execution important : respecter les dependances FK
-- ============================================================

-- 1. Colonne resolved_at dans alerts
ALTER TABLE `alerts`
  ADD COLUMN IF NOT EXISTS `resolved_at` DATETIME NULL DEFAULT NULL AFTER `read_at`;

CREATE INDEX IF NOT EXISTS `idx_alerts_resolved` ON `alerts`(`resolved_at`);

-- 2. Colonnes manquantes dans import_jobs
ALTER TABLE `import_jobs`
  ADD COLUMN IF NOT EXISTS `skipped_lines`   INT          DEFAULT 0   AFTER `error_message`,
  ADD COLUMN IF NOT EXISTS `import_source`   VARCHAR(255)             AFTER `skipped_lines`,
  ADD COLUMN IF NOT EXISTS `import_service`  VARCHAR(255)             AFTER `import_source`;

-- 3. Table watch_offsets (requise par watcherService)
CREATE TABLE IF NOT EXISTS `watch_offsets` (
  `path`       VARCHAR(1024) PRIMARY KEY,
  `offset`     BIGINT       DEFAULT 0,
  `updated_at` DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. Corriger les alert_rules avec created_by = NULL
--    Les assigner au premier admin actif pour respecter le multi-tenant
UPDATE `alert_rules`
SET    `created_by` = (SELECT `id` FROM `users` WHERE `role` = 'admin' AND `is_active` = 1 ORDER BY `id` ASC LIMIT 1)
WHERE  `created_by` IS NULL;

-- 5. Index de performance sur logs (si manquants)
CREATE INDEX IF NOT EXISTS `idx_logs_user_timestamp` ON `logs`(`user_id`, `timestamp`);
CREATE INDEX IF NOT EXISTS `idx_logs_fingerprint`    ON `logs`(`fingerprint`);
CREATE INDEX IF NOT EXISTS `idx_logs_level`          ON `logs`(`log_level`);
CREATE INDEX IF NOT EXISTS `idx_logs_timestamp`      ON `logs`(`timestamp`);

-- ============================================================
-- FIN DE MIGRATION V4 → V5
-- ============================================================
