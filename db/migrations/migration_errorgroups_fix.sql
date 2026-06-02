-- Migration pour corriger le schéma error_groups
-- Remplace UNIQUE(fingerprint) par UNIQUE(fingerprint + user_id)

-- Supprimer l'ancienne contrainte UNIQUE
ALTER TABLE error_groups DROP INDEX fingerprint;

-- Ajouter la nouvelle contrainte UNIQUE sur (fingerprint, user_id)
ALTER TABLE error_groups ADD UNIQUE INDEX idx_fingerprint_user (fingerprint, user_id);

-- Mettre à jour les enregistrements existants (optionnel - assigne au premier utilisateur admin)
UPDATE error_groups SET user_id = (SELECT id FROM users WHERE role = 'admin' LIMIT 1) WHERE user_id IS NULL;
