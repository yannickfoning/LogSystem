-- Script de setup pour Aiven MySQL
-- Exécuter ce script une seule fois après la création de la base

SET NAMES utf8mb4;

-- Table sessions pour express-mysql-session
CREATE TABLE IF NOT EXISTS `sessions` (
  `session_id` VARCHAR(128) NOT NULL PRIMARY KEY,
  `expires` INT(11) UNSIGNED NOT NULL,
  `data` MEDIUMTEXT,
  INDEX `sessions_expires_idx` (`expires`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table watch_log_metrics si manquante
CREATE TABLE IF NOT EXISTS `watch_log_metrics` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `path` VARCHAR(1024),
  `lines_parsed` INT DEFAULT 0,
  `errors` INT DEFAULT 0,
  `last_run` DATETIME,
  `user_id` INT,
  INDEX `idx_wlm_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table anomalies si manquante
CREATE TABLE IF NOT EXISTS `anomalies` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `type` VARCHAR(100),
  `severity` VARCHAR(20),
  `message` TEXT,
  `detected_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `user_id` INT,
  `metadata` JSON,
  INDEX `idx_anomalies_user` (`user_id`),
  INDEX `idx_anomalies_detected` (`detected_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table parser_metrics si manquante
CREATE TABLE IF NOT EXISTS `parser_metrics` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `format` VARCHAR(50),
  `lines_parsed` INT DEFAULT 0,
  `errors` INT DEFAULT 0,
  `duration_ms` INT DEFAULT 0,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT 'Setup Aiven terminé avec succès' AS status;
