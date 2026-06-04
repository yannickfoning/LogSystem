-- LogSystem V6 Migration
-- Phase 4 (Dates enrichies), Phase 5 (Alertes par défaut) et Indexation Optimisée (Phase 1 & 7)

SET FOREIGN_KEY_CHECKS = 0;

-- ==========================================
-- 1. ENRICHISSEMENT DES COLONNES DE TEMPS (Phase 4)
-- ==========================================
ALTER TABLE `logs` 
  ADD COLUMN IF NOT EXISTS `created_at_log` DATETIME NULL COMMENT 'Date brute extraite du texte',
  ADD COLUMN IF NOT EXISTS `created_time_log` TIME NULL COMMENT 'Heure brute extraite du texte',
  ADD COLUMN IF NOT EXISTS `imported_time` TIME NULL COMMENT 'Heure d import dans le système',
  ADD COLUMN IF NOT EXISTS `file_created_at` DATETIME NULL COMMENT 'Date de création fs.stat birthtime',
  ADD COLUMN IF NOT EXISTS `file_modified_at` DATETIME NULL COMMENT 'Date de modification fs.stat mtime';

-- Mettre à jour les colonnes de temps calculables pour les logs existants
UPDATE `logs` SET `imported_time` = TIME(`imported_at`) WHERE `imported_time` IS NULL AND `imported_at` IS NOT NULL;

-- ==========================================
-- 2. AJOUT DES INDEX REQUIS PAR L'AUDIT (Phase 1 & 7)
-- ==========================================
ALTER TABLE `logs` ADD INDEX IF NOT EXISTS `idx_audit_severity` (`log_level`);
ALTER TABLE `logs` ADD INDEX IF NOT EXISTS `idx_audit_timestamp` (`timestamp`);
ALTER TABLE `logs` ADD INDEX IF NOT EXISTS `idx_audit_source` (`source`);
ALTER TABLE `logs` ADD INDEX IF NOT EXISTS `idx_audit_directory` (`module` COMMENT 'Représente le répertoire/module');
ALTER TABLE `logs` ADD INDEX IF NOT EXISTS `idx_audit_user_id` (`user_id`);

-- Index composite optimisé pour les recherches croisées (Ex: ERROR + nginx + Date)
ALTER TABLE `logs` ADD INDEX IF NOT EXISTS `idx_logs_combined_search` (`user_id`, `log_level`, `source`, `timestamp`);

-- ==========================================
-- 3. INITIALISATION DES ALERTES PAR DÉFAUT (Phase 5)
-- ==========================================
-- Seed idempotent: insert only if a rule with same name + created_by exists
-- We duplicate rules per existing admin user (created_by set to admin id)

INSERT INTO `alert_rules` (`id`, `name`, `description`, `condition_type`, `condition_value`, `threshold_value`, `time_window_minutes`, `severity`, `cooldown_minutes`, `is_active`, `created_by`) 
SELECT
  v.id,
  v.name,
  v.description,
  v.condition_type,
  v.condition_value,
  v.threshold_value,
  v.time_window_minutes,
  v.severity,
  v.cooldown_minutes,
  1,
  a.id AS created_by
FROM (
  SELECT 101 AS id, 'ERROR_LIMIT' AS name, '10 erreurs / 5 minutes' AS description, 'threshold' AS condition_type, 'ERROR' AS condition_value, 10 AS threshold_value, 5 AS time_window_minutes, 'high' AS severity, 10 AS cooldown_minutes
  UNION ALL
  SELECT 102, 'FATAL_TRIGGER', '1 occurrence critique ou fatale', 'threshold', 'FATAL', 1, 1, 'critical', 5
  UNION ALL
  SELECT 103, 'SECURITY_BREACH', '3 occurrences de patterns de sécurité suspectes', 'threshold', 'SECURITY', 3, 15, 'critical', 10
  UNION ALL
  SELECT 104, 'AUTH_BRUTEFORCE', '5 échecs d authentification détectés', 'threshold', 'AUTH', 5, 10, 'high', 15
  UNION ALL
  SELECT 105, 'DISK_THRESHOLD', 'Utilisation disque supérieure à 80%', 'threshold', 'DISK', 80, 5, 'medium', 60
) v
JOIN (
  SELECT id FROM users WHERE role = 'admin' AND is_active = 1
) a
WHERE NOT EXISTS (
  SELECT 1
  FROM `alert_rules` r
  WHERE r.`name` = v.`name`
    AND r.`created_by` = a.id
);

SET FOREIGN_KEY_CHECKS = 1;

