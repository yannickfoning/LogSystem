-- Migration for sharing functionality
-- Adds table to track shared log links with expiration

CREATE TABLE IF NOT EXISTS `shared_links` (
  `id` VARCHAR(64) PRIMARY KEY,
  `user_id` INT NOT NULL,
  `log_ids` JSON NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `access_count` INT DEFAULT 0,
  `last_accessed` DATETIME NULL,
  INDEX `idx_shared_links_user` (`user_id`),
  INDEX `idx_shared_links_expires` (`expires_at`),
  CONSTRAINT `fk_shared_links_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add audit log entries for sharing activities
INSERT INTO `audit_log` (`user_id`, `user_email`, `action`, `resource_type`, `resource_id`, `details`, `status`)
SELECT 
  id, 
  email, 
  'system_init', 
  'shared_links', 
  'table_creation', 
  'Created shared_links table for log sharing functionality', 
  'success'
FROM users 
WHERE role = 'admin'
LIMIT 1;