-- ============================================================================
-- Migration 001: Add Log Intelligence
--
-- Ajoute les colonnes d'enrichissement aux tables logs et error_groups
-- pour supporter la détection de retours d'erreurs et les métadonnées
-- enrichies (server source, timestamps inférés, confidence scores).
--
-- Cette migration est idempotente : elle peut être exécutée plusieurs
-- fois sans erreur.
--
-- IMPORTANT: Ce fichier doit être exécuté statement par statement via
-- votre runner de migration Node.js (mysql2). Les commandes DELIMITER
-- ne sont pas supportées par les drivers Node.js.
-- ============================================================================

-- ============================================================================
-- TABLE: logs — Colonnes
-- ============================================================================

ALTER TABLE logs ADD created_time TIME NULL AFTER timestamp;
ALTER TABLE logs ADD imported_at DATETIME DEFAULT CURRENT_TIMESTAMP AFTER created_time;
ALTER TABLE logs ADD timezone VARCHAR(64) NULL AFTER imported_at;
ALTER TABLE logs ADD source_server VARCHAR(255) NULL AFTER source;
ALTER TABLE logs ADD parser_format VARCHAR(50) NULL AFTER target_user;
ALTER TABLE logs ADD timestamp_inferred TINYINT(1) DEFAULT 0 AFTER parser_format;
ALTER TABLE logs ADD classification_confidence DECIMAL(4,3) DEFAULT 0.500 AFTER timestamp_inferred;
ALTER TABLE logs ADD COLUMN source_type ENUM('watch', 'import', 'api', 'manual') DEFAULT 'watch' AFTER user_id;
ALTER TABLE logs ADD COLUMN ingested_realtime TINYINT(1) DEFAULT 1 AFTER source_type;

-- ============================================================================
-- TABLE: logs — Index
-- ============================================================================

ALTER TABLE logs ADD INDEX idx_logs_source_server (source_server);
ALTER TABLE logs ADD INDEX idx_logs_error_type (error_type);
ALTER TABLE logs ADD INDEX idx_logs_user_error_type_ts (user_id, error_type, timestamp DESC);
ALTER TABLE logs ADD INDEX idx_logs_user_fingerprint_ts (user_id, fingerprint, timestamp DESC);
ALTER TABLE logs ADD INDEX idx_logs_imported_at (imported_at);
ALTER TABLE logs ADD INDEX idx_logs_realtime (ingested_realtime, imported_at);

-- ============================================================================
-- TABLE: logs — Valeurs par défaut pour les nouvelles colonnes
-- ============================================================================

UPDATE logs SET imported_at = COALESCE(imported_at, created_at, NOW()) WHERE imported_at IS NULL;
UPDATE logs SET source_server = COALESCE(source_server, source) WHERE source_server IS NULL;
UPDATE logs SET created_time = COALESCE(created_time, TIME(timestamp)) WHERE created_time IS NULL;

-- ============================================================================
-- TABLE: error_groups — Colonnes
-- ============================================================================

ALTER TABLE error_groups ADD COLUMN previous_seen DATETIME NULL AFTER last_seen;
ALTER TABLE error_groups ADD COLUMN resolved_at DATETIME NULL AFTER previous_seen;
ALTER TABLE error_groups ADD COLUMN returned_at DATETIME NULL AFTER resolved_at;
ALTER TABLE error_groups ADD COLUMN return_count INT DEFAULT 0 AFTER returned_at;
ALTER TABLE error_groups ADD COLUMN return_reason TEXT NULL AFTER return_count;
ALTER TABLE error_groups ADD COLUMN source_server VARCHAR(255) NULL AFTER return_reason;
ALTER TABLE error_groups ADD COLUMN service VARCHAR(255) NULL AFTER source_server;
ALTER TABLE error_groups ADD COLUMN error_type VARCHAR(100) NULL AFTER service;

-- ============================================================================
-- TABLE: error_groups — Index
-- ============================================================================

ALTER TABLE error_groups ADD INDEX idx_error_groups_status_last (status, last_seen DESC);
ALTER TABLE error_groups ADD INDEX idx_error_groups_error_type (error_type);

-- ============================================================================
-- TABLE: error_groups — Modifier l'enum status
-- ============================================================================

ALTER TABLE error_groups MODIFY COLUMN status ENUM('open','resolved','returned') DEFAULT 'open';
