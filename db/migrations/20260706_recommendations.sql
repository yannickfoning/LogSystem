-- Migration for recommendations table
-- Allows admins to create and manage problem resolution recommendations by log type

CREATE TABLE IF NOT EXISTS error_recommendations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  error_type VARCHAR(255) NOT NULL,
  event_type VARCHAR(255),
  log_level VARCHAR(50),
  pattern_keywords TEXT,
  recommendation TEXT NOT NULL,
  priority INT DEFAULT 0,
  is_active TINYINT(1) DEFAULT 1,
  created_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_error_type (error_type),
  INDEX idx_event_type (event_type),
  INDEX idx_log_level (log_level),
  INDEX idx_is_active (is_active),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
