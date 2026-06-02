-- Fix pour les user_id NULL dans les données existantes
-- Assigne toutes les données sans user_id au compte admin (id = 1)

-- Mettre à jour les logs avec user_id NULL
UPDATE logs 
SET user_id = 1 
WHERE user_id IS NULL;

-- Mettre à jour les error_groups avec user_id NULL
UPDATE error_groups 
SET user_id = 1 
WHERE user_id IS NULL;

-- Mettre à jour les alerts avec user_id NULL
UPDATE alerts 
SET user_id = 1 
WHERE user_id IS NULL;

-- Mettre à jour les import_jobs avec user_id NULL
UPDATE import_jobs 
SET user_id = 1 
WHERE user_id IS NULL;

-- Afficher le nombre de lignes mises à jour pour vérification
SELECT 
  'logs' as table_name, COUNT(*) as updated_rows 
FROM logs WHERE user_id = 1
UNION ALL
SELECT 
  'error_groups' as table_name, COUNT(*) as updated_rows 
FROM error_groups WHERE user_id = 1
UNION ALL
SELECT 
  'alerts' as table_name, COUNT(*) as updated_rows 
FROM alerts WHERE user_id = 1
UNION ALL
SELECT 
  'import_jobs' as table_name, COUNT(*) as updated_rows 
FROM import_jobs WHERE user_id = 1;
