#!/bin/bash
# Script d'initialisation de la base de données MariaDB dans Docker

set -e

echo "========================================"
echo "Initialisation de la base de données"
echo "========================================"
echo ""

# Vérifier si le conteneur MariaDB est en cours d'exécution
if ! docker ps | grep -q logsystem-mariadb; then
    echo "[ERREUR] Le conteneur MariaDB n'est pas en cours d'exécution"
    echo "Démarrez d'abord les services avec: docker-compose up -d"
    exit 1
fi

echo "[INFO] Connexion à MariaDB..."
echo ""

# Exécuter le script de schéma si le fichier existe
if [ -f "./db/schema.sql" ]; then
    echo "[INFO] Exécution du schéma de base de données..."
    docker exec -i logsystem-mariadb mariadb -u root -pLogSystem2024! logsystem < ./db/schema.sql
    echo "[OK] Schéma appliqué"
else
    echo "[AVERTISSEMENT] Fichier db/schema.sql non trouvé"
fi

# Exécuter les migrations
if [ -d "./db/migrations" ]; then
    echo "[INFO] Exécution des migrations..."
    for migration in ./db/migrations/*.sql; do
        if [ -f "$migration" ]; then
            echo "  - $(basename $migration)"
            docker exec -i logsystem-mariadb mariadb -u root -pLogSystem2024! logsystem < "$migration"
        fi
    done
    echo "[OK] Migrations appliquées"
else
    echo "[AVERTISSEMENT] Dossier db/migrations non trouvé"
fi

echo ""
echo "[INFO] Création de l'utilisateur admin par défaut..."
docker exec logsystem-mariadb mariadb -u root -pLogSystem2024! logsystem -e "
INSERT INTO users (email, password, display_name, role, created_at, updated_at)
VALUES (
    'admin@logsystem.local',
    '\$2b\$12\$REPLACE_WITH_BCRYPT_HASH',
    'Administrateur',
    'admin',
    NOW(),
    NOW()
)
ON DUPLICATE KEY UPDATE email=email;
"

echo ""
echo "========================================"
echo "✓ Base de données initialisée"
echo "========================================"
echo ""
echo "Pour créer l'utilisateur admin avec un mot de passe sécurisé:"
echo "  docker exec -it logsystem-mariadb mariadb -u root -pLogSystem2024! logsystem"
echo ""
echo "Puis exécutez dans MariaDB:"
echo "  INSERT INTO users (email, password, display_name, role, created_at, updated_at)"
echo "  VALUES ('admin@logsystem.local', '\$2b\$12\$votre_hash_bcrypt', 'Administrateur', 'admin', NOW(), NOW());"
echo ""
