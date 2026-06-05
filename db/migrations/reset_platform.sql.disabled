-- Réinitialisation complète de la plateforme LogSystem
-- Supprime toutes les données et recrée les utilisateurs par défaut

-- Désactiver les contraintes de clé étrangère
SET FOREIGN_KEY_CHECKS = 0;

-- Vider toutes les tables
DELETE FROM alerts;
DELETE FROM alert_rules;
DELETE FROM audit_log;
DELETE FROM import_jobs;
DELETE FROM error_groups;
DELETE FROM logs;
DELETE FROM users;

-- Réactiver les contraintes de clé étrangère
SET FOREIGN_KEY_CHECKS = 1;

-- Réinsérer les utilisateurs par défaut
INSERT INTO users (id, email, password_hash, display_name, role, is_active, created_at, updated_at) VALUES
(1, 'admin@logsystem.local', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj6QJw/2Ej7W', 'Admin', 'admin', 1, NOW(), NOW()),
(2, 'user@logsystem.local', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj6QJw/2Ej7W', 'User', 'user', 1, NOW(), NOW());

-- Réinsérer les règles d'alerte par défaut
INSERT INTO alert_rules (id, name, description, conditions, severity, is_active, created_by, created_at, updated_at) VALUES
(1, 'Erreur critique', 'Alerte sur les erreurs critiques', '{"level": "error", "count": 1, "timeframe": 300}', 'critical', 1, 1, NOW(), NOW()),
(2, 'Pic d\'erreurs', 'Alerte sur les pics d\'erreurs', '{"level": "error", "count": 10, "timeframe": 60}', 'high', 1, 1, NOW(), NOW()),
(3, 'Aucune activité', 'Alerte si aucune activité', '{"level": "info", "count": 0, "timeframe": 3600}', 'medium', 1, 1, NOW(), NOW());

-- Réinitialiser les compteurs d'auto-incrémentation
ALTER TABLE users AUTO_INCREMENT = 3;
ALTER TABLE logs AUTO_INCREMENT = 1;
ALTER TABLE alerts AUTO_INCREMENT = 1;
ALTER TABLE alert_rules AUTO_INCREMENT = 4;
ALTER TABLE audit_log AUTO_INCREMENT = 1;
ALTER TABLE import_jobs AUTO_INCREMENT = 1;
ALTER TABLE error_groups AUTO_INCREMENT = 1;

SELECT 'Plateforme réinitialisée avec succès' AS message;
