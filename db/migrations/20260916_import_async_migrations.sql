-- Migration pour l'import asynchrone
-- Ajout des colonnes nécessaires pour le suivi en temps réel des imports

-- Ajouter started_at pour le début du traitement
ALTER TABLE import_jobs ADD COLUMN started_at DATETIME NULL AFTER created_at;

-- Ajouter updated_at pour le suivi des mises à jour
ALTER TABLE import_jobs ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER started_at;

-- Ajouter index pour les requêtes de statut par utilisateur
ALTER TABLE import_jobs ADD INDEX idx_status_user (status, user_id);

-- Ajouter index pour le suivi par job_id (déjà indexé par clé primaire, mais utile pour les jointures)
-- CREATE INDEX idx_import_job_id ON logs (import_job_id); -- Déjà créé dans add_import_tracking_columns.sql