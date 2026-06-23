-- Anomalies table used by services/anomaliesService.js (volume spike detection)
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
