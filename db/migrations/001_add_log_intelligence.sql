-- ============================================================================
-- Migration 001: Add Log Intelligence
-- 
-- Ajoute les colonnes d'enrichissement aux tables logs et error_groups
-- pour supporter la détection de retours d'erreurs et les métadonnées
-- enrichies (server source, timestamps inférés, confidence scores).
--
-- Cette migration est idempotente : elle peut être exécutée plusieurs
-- fois sans erreur (IF NOT EXISTS).
-- ============================================================================

-- ============================================================================
-- TABLE: logs
-- ============================================================================

DROP PROCEDURE IF EXISTS migrations_001_update_logs;
DELIMITER //
CREATE PROCEDURE migrations_001_update_logs()
BEGIN
    -- Colonnes pour logs
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'logs' AND COLUMN_NAME = 'created_time') THEN
        ALTER TABLE logs ADD COLUMN created_time TIME NULL AFTER timestamp;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'logs' AND COLUMN_NAME = 'imported_at') THEN
        ALTER TABLE logs ADD COLUMN imported_at DATETIME DEFAULT CURRENT_TIMESTAMP AFTER created_time;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'logs' AND COLUMN_NAME = 'timezone') THEN
        ALTER TABLE logs ADD COLUMN timezone VARCHAR(64) NULL AFTER imported_at;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'logs' AND COLUMN_NAME = 'source_server') THEN
        ALTER TABLE logs ADD COLUMN source_server VARCHAR(255) NULL AFTER source;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'logs' AND COLUMN_NAME = 'parser_format') THEN
        ALTER TABLE logs ADD COLUMN parser_format VARCHAR(50) NULL AFTER target_user;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'logs' AND COLUMN_NAME = 'timestamp_inferred') THEN
        ALTER TABLE logs ADD COLUMN timestamp_inferred TINYINT(1) DEFAULT 0 AFTER parser_format;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'logs' AND COLUMN_NAME = 'classification_confidence') THEN
        ALTER TABLE logs ADD COLUMN classification_confidence DECIMAL(4,3) DEFAULT 0.500 AFTER timestamp_inferred;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'logs' AND COLUMN_NAME = 'source_type') THEN
        ALTER TABLE logs ADD COLUMN source_type ENUM('watch', 'import', 'api', 'manual') DEFAULT 'watch' AFTER user_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'logs' AND COLUMN_NAME = 'ingested_realtime') THEN
        ALTER TABLE logs ADD COLUMN ingested_realtime TINYINT(1) DEFAULT 1 AFTER source_type;
    END IF;

    -- Index pour logs
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'logs' AND INDEX_NAME = 'idx_logs_source_server') THEN
        CREATE INDEX idx_logs_source_server ON logs(source_server);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'logs' AND INDEX_NAME = 'idx_logs_error_type') THEN
        CREATE INDEX idx_logs_error_type ON logs(error_type);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'logs' AND INDEX_NAME = 'idx_logs_user_error_type_ts') THEN
        CREATE INDEX idx_logs_user_error_type_ts ON logs(user_id, error_type, timestamp DESC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'logs' AND INDEX_NAME = 'idx_logs_user_fingerprint_ts') THEN
        CREATE INDEX idx_logs_user_fingerprint_ts ON logs(user_id, fingerprint, timestamp DESC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'logs' AND INDEX_NAME = 'idx_logs_imported_at') THEN
        CREATE INDEX idx_logs_imported_at ON logs(imported_at);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'logs' AND INDEX_NAME = 'idx_logs_realtime') THEN
        CREATE INDEX idx_logs_realtime ON logs(ingested_realtime, imported_at);
    END IF;
END //
DELIMITER ;
CALL migrations_001_update_logs();
DROP PROCEDURE migrations_001_update_logs;

-- Remplir les colonnes nouvelles avec des valeurs sensées par défaut
UPDATE logs SET imported_at = COALESCE(imported_at, created_at, NOW())
  WHERE imported_at IS NULL;
UPDATE logs SET source_server = COALESCE(source_server, source)
  WHERE source_server IS NULL;
UPDATE logs SET created_time = COALESCE(created_time, TIME(timestamp))
  WHERE created_time IS NULL;

-- ============================================================================
-- TABLE: error_groups
-- ============================================================================

DROP PROCEDURE IF EXISTS migrations_001_update_error_groups;
DELIMITER //
CREATE PROCEDURE migrations_001_update_error_groups()
BEGIN
    -- Colonnes pour error_groups
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'error_groups' AND COLUMN_NAME = 'previous_seen') THEN
        ALTER TABLE error_groups ADD COLUMN previous_seen DATETIME NULL AFTER last_seen;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'error_groups' AND COLUMN_NAME = 'resolved_at') THEN
        ALTER TABLE error_groups ADD COLUMN resolved_at DATETIME NULL AFTER previous_seen;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'error_groups' AND COLUMN_NAME = 'returned_at') THEN
        ALTER TABLE error_groups ADD COLUMN returned_at DATETIME NULL AFTER resolved_at;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'error_groups' AND COLUMN_NAME = 'return_count') THEN
        ALTER TABLE error_groups ADD COLUMN return_count INT DEFAULT 0 AFTER returned_at;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'error_groups' AND COLUMN_NAME = 'return_reason') THEN
        ALTER TABLE error_groups ADD COLUMN return_reason TEXT NULL AFTER return_count;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'error_groups' AND COLUMN_NAME = 'source_server') THEN
        ALTER TABLE error_groups ADD COLUMN source_server VARCHAR(255) NULL AFTER return_reason;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'error_groups' AND COLUMN_NAME = 'service') THEN
        ALTER TABLE error_groups ADD COLUMN service VARCHAR(255) NULL AFTER source_server;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'error_groups' AND COLUMN_NAME = 'error_type') THEN
        ALTER TABLE error_groups ADD COLUMN error_type VARCHAR(100) NULL AFTER service;
    END IF;

    -- Index pour error_groups
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'error_groups' AND INDEX_NAME = 'idx_error_groups_status_last') THEN
        CREATE INDEX idx_error_groups_status_last ON error_groups(status, last_seen DESC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'error_groups' AND INDEX_NAME = 'idx_error_groups_error_type') THEN
        CREATE INDEX idx_error_groups_error_type ON error_groups(error_type);
    END IF;
END //
DELIMITER ;
CALL migrations_001_update_error_groups();
DROP PROCEDURE migrations_001_update_error_groups;

-- Modifier le type d'enum pour inclure 'returned'
ALTER TABLE error_groups
  MODIFY COLUMN status ENUM('open','resolved','returned') DEFAULT 'open';
