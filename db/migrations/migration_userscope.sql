-- Migration pour ajouter le support du filtrage par utilisateur
-- Ajoute user_id dans les tables alerts et error_groups

-- Ajouter user_id à la table alerts
ALTER TABLE alerts 
ADD COLUMN user_id INT,
ADD INDEX idx_alerts_user_id (user_id);

-- Ajouter user_id à la table error_groups  
ALTER TABLE error_groups
ADD COLUMN user_id INT,
ADD INDEX idx_error_groups_user_id (user_id);

-- Mettre à jour les données existantes (optionnel - assigne au premier utilisateur admin)
-- NOTE: À adapter selon vos besoins
UPDATE alerts SET user_id = (SELECT id FROM users WHERE role = 'admin' LIMIT 1) WHERE user_id IS NULL;
UPDATE error_groups SET user_id = (SELECT id FROM users WHERE role = 'admin' LIMIT 1) WHERE user_id IS NULL;
