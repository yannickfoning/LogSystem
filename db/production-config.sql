-- LogSystem - Configuration Base de Données Production
-- Ce script configure MySQL 8 pour la production avec sécurité renforcée
--
-- IMPORTANT:
-- 1. Exécutez ce script en tant que root sur votre serveur MySQL de production
-- 2. Remplacez tous les mots de passe par des valeurs fortes et uniques
-- 3. Sauvegardez les mots de passe dans un gestionnaire de secrets (AWS Secrets Manager, Vault, etc.)
--
-- Utilisation:
-- mysql -u root -p < db/production-config.sql

-- ============================================
-- VARIABLES À MODIFIER AVANT L'EXÉCUTION
-- ============================================

-- Mot de passe pour l'utilisateur applicatif logsystem
-- Générez un mot de passe fort: openssl rand -base64 32
SET @logsystem_password = 'CHANGE_THIS_STRONG_PASSWORD_HERE_MIN_32_CHARS';

-- Mot de passe root (optionnel - à changer si c'est un nouveau serveur)
SET @root_password = 'CHANGE_ROOT_PASSWORD_IF_NEEDED';

-- ============================================
-- SÉCURITÉ MYSQL
-- ============================================

-- Supprimer les utilisateurs anonymes
DELETE FROM mysql.user WHERE User='';

-- Supprimer la base de données test
DROP DATABASE IF EXISTS test;
DELETE FROM mysql.db WHERE Db='test' OR Db='test\_%';

-- Empêcher l'accès root distant (sauf si nécessaire)
-- Décommentez si vous avez besoin d'accès root distant:
-- UPDATE mysql.user SET Host='%' WHERE User='root' AND Host='localhost';

-- ============================================
-- CRÉATION BASE DE DONNÉES
-- ============================================

CREATE DATABASE IF NOT EXISTS logsystem
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

-- ============================================
-- CRÉATION UTILISATEUR APPLICATIF
-- ============================================

-- Supprimer l'utilisateur s'il existe (pour recreation propre)
DROP USER IF EXISTS 'logsystem'@'%';
DROP USER IF EXISTS 'logsystem'@'localhost';

-- Créer l'utilisateur avec mot de passe fort
CREATE USER 'logsystem'@'%' IDENTIFIED BY @logsystem_password;

-- ============================================
-- DROITS UTILISATEUR
-- ============================================

-- Donner les droits nécessaires sur la base logsystem uniquement
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, EXECUTE
  ON logsystem.*
  TO 'logsystem'@'%';

-- Droits de lecture sur information_schema (pour les requêtes système)
GRANT SELECT ON information_schema.* TO 'logsystem'@'%';

-- ============================================
-- CHANGER MOT DE PASSE ROOT (OPTIONNEL)
-- ============================================

-- Décommentez et utilisez uniquement pour un nouveau serveur ou pour changer le mot de passe
-- ALTER USER 'root'@'localhost' IDENTIFIED BY @root_password;
-- FLUSH PRIVILEGES;

-- ============================================
-- VALIDATION
-- ============================================

FLUSH PRIVILEGES;

-- Afficher un résumé
SELECT '=== CONFIGURATION TERMINÉE ===' AS status;
SELECT 'Base de données: logsystem' AS database;
SELECT 'Utilisateur: logsystem@%' AS user;
SELECT CONCAT('IMPORTANT: Sauvegardez ce mot de passe: ', @logsystem_password) AS warning;
SELECT 'Configurez DB_PASSWORD dans .env avec cette valeur' AS next_step;
