-- Migration pour améliorer le suivi des imports d'archives
-- Ajoute des status intermédiaires et des colonnes de suivi

-- Note: Cette migration nécessite une vérification manuelle de la structure actuelle
-- Exécuter les commandes une par une si nécessaire

-- 1. Modifier l'ENUM status pour inclure les états intermédiaires
ALTER TABLE import_jobs 
MODIFY COLUMN status ENUM('pending','extracting','parsing','inserting','processing','completed','failed') 
DEFAULT 'pending';

-- 2. Ajouter la colonne updated_at (vérifier si elle existe déjà)
-- ALTER TABLE import_jobs 
-- ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- 3. Ajouter la colonne total_files (vérifier si elle existe déjà)  
-- ALTER TABLE import_jobs 
-- ADD COLUMN total_files INT DEFAULT 1;

-- 4. Ajouter un index sur status pour améliorer les requêtes de suivi
CREATE INDEX idx_import_jobs_status ON import_jobs(status);

-- 5. Ajouter un index sur user_id et status pour les requêtes utilisateur
CREATE INDEX idx_import_jobs_user_status ON import_jobs(user_id, status);