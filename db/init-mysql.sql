-- LogSystem - Initialisation MySQL 8
-- Ce script crée la base de données et un utilisateur applicatif avec droits limités
-- À exécuter en tant que root : mysql -u root -p < db/init-mysql.sql

-- Créer la base de données
CREATE DATABASE IF NOT EXISTS logsystem
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

-- Créer un utilisateur applicatif avec droits limités (jamais root en production)
-- REMARQUE: Modifiez 'StrongPasswordHere123!' par un mot de passe fort
CREATE USER IF NOT EXISTS 'logsystem'@'localhost' IDENTIFIED BY 'StrongPasswordHere123!';

-- Donner les droits nécessaires à l'utilisateur sur la base logsystem uniquement
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, EXECUTE
  ON logsystem.*
  TO 'logsystem'@'localhost';

-- Rafraîchir les privilèges
FLUSH PRIVILEGES;

-- Afficher un résumé
SELECT 'Base de données logsystem créée avec succès' AS status;
SELECT 'Utilisateur logsystem@localhost créé avec droits limités' AS status;
SELECT 'IMPORTANT: Mettez à jour .env avec DB_USER=logsystem et DB_PASSWORD=StrongPasswordHere123!' AS warning;
