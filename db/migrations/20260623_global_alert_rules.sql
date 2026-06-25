-- Seed global alert rules for all users (Vercel serverless + multi-tenant)
-- Idempotent: skips rules that already exist as global

SET @admin_id = (SELECT id FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 1);

INSERT INTO alert_rules (name, description, condition_type, condition_value, threshold_value, time_window_minutes, severity, cooldown_minutes, is_active, is_global, applicable_to_users, created_by)
SELECT 'Erreurs fréquentes (ERROR)', 'Détecte 10+ erreurs ERROR sur 5 minutes', 'level', 'ERROR', 10, 5, 'high', 10, 1, 1, NULL, @admin_id
WHERE @admin_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM alert_rules WHERE name = 'Erreurs fréquentes (ERROR)' AND is_global = 1);

INSERT INTO alert_rules (name, description, condition_type, condition_value, threshold_value, time_window_minutes, severity, cooldown_minutes, is_active, is_global, applicable_to_users, created_by)
SELECT 'FATAL détecté', 'Alerte immédiate sur toute occurrence FATAL', 'level', 'FATAL', 1, 60, 'critical', 5, 1, 1, NULL, @admin_id
WHERE @admin_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM alert_rules WHERE name = 'FATAL détecté' AND is_global = 1);

INSERT INTO alert_rules (name, description, condition_type, condition_value, threshold_value, time_window_minutes, severity, cooldown_minutes, is_active, is_global, applicable_to_users, created_by)
SELECT 'CRITICAL détecté', 'Alerte immédiate sur toute occurrence CRITICAL', 'level', 'CRITICAL', 1, 60, 'critical', 10, 1, 1, NULL, @admin_id
WHERE @admin_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM alert_rules WHERE name = 'CRITICAL détecté' AND is_global = 1);

INSERT INTO alert_rules (name, description, condition_type, condition_value, threshold_value, time_window_minutes, severity, cooldown_minutes, is_active, is_global, applicable_to_users, created_by)
SELECT 'Erreurs critiques (1h)', 'Plus de 50 erreurs ERROR sur 1 heure', 'level', 'ERROR', 50, 60, 'high', 30, 1, 1, NULL, @admin_id
WHERE @admin_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM alert_rules WHERE name = 'Erreurs critiques (1h)' AND is_global = 1);

INSERT INTO alert_rules (name, description, condition_type, condition_value, threshold_value, time_window_minutes, severity, cooldown_minutes, is_active, is_global, applicable_to_users, created_by)
SELECT 'Pic de WARNINGs', 'Détecte 100+ warnings sur 15 minutes', 'level', 'WARNING', 100, 15, 'medium', 20, 1, 1, NULL, @admin_id
WHERE @admin_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM alert_rules WHERE name = 'Pic de WARNINGs' AND is_global = 1);
