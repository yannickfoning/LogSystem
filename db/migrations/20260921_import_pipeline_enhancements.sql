-- Migration pour les améliorations du pipeline d'import selon le cahier des charges
-- Ajout: dépôt/traitement séparés, dissociation import/décompte

-- Ajouter les colonnes de chemins pour les répertoires dépôt/traité
ALTER TABLE import_jobs 
ADD COLUMN depot_path VARCHAR(512) DEFAULT NULL AFTER total_files,
ADD COLUMN treated_path VARCHAR(512) DEFAULT NULL AFTER depot_path;

-- Mettre à jour l'ENUM status pour inclure 'depositing' et 'counting'
ALTER TABLE import_jobs 
MODIFY COLUMN status ENUM('pending','depositing','extracting','parsing','counting','inserting','processing','completed','failed') DEFAULT 'pending';

-- Ajouter un index sur le status pour le suivi des jobs en cours
CREATE INDEX idx_import_jobs_status ON import_jobs(status, created_at DESC);

-- Ajouter un index sur user_id pour les logs récents avec ID utilisateur
CREATE INDEX idx_import_jobs_user_created ON import_jobs(user_id, created_at DESC);
