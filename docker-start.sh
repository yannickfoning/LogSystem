#!/bin/bash
# Script de démarrage Docker pour LogSystem avec MariaDB

set -e

echo "========================================"
echo "LogSystem - Démarrage avec Docker"
echo "========================================"
echo ""

# Vérifier si Docker est installé
if ! command -v docker &> /dev/null; then
    echo "[ERREUR] Docker n'est pas installé"
    echo "Installez Docker depuis https://www.docker.com/get-started"
    exit 1
fi

# Vérifier si Docker Compose est installé
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "[ERREUR] Docker Compose n'est pas installé"
    echo "Installez Docker Compose depuis https://docs.docker.com/compose/install/"
    exit 1
fi

echo "[OK] Docker et Docker Compose sont installés"
echo ""

# Arrêter les conteneurs existants
echo "[INFO] Arrêt des conteneurs existants..."
docker-compose down 2>/dev/null || docker compose down 2>/dev/null || true

# Construire les images
echo "[INFO] Construction des images Docker..."
docker-compose build 2>/dev/null || docker compose build

# Démarrer les services
echo "[INFO] Démarrage des services (MariaDB, Redis, LogSystem)..."
docker-compose up -d 2>/dev/null || docker compose up -d

echo ""
echo "========================================"
echo "LogSystem est en cours de démarrage"
echo "========================================"
echo ""
echo "Services:"
echo "  - MariaDB: localhost:3306"
echo "  - Redis: localhost:6379"
echo "  - LogSystem: http://localhost:10000"
echo ""
echo "Attendez 30-60 secondes pour que les services démarrent..."
echo ""

# Attendre que MariaDB soit prêt
echo "[INFO] Attente de MariaDB..."
for i in {1..30}; do
    if docker exec logsystem-mariadb mariadb-admin ping -h localhost -u root -pLogSystem2024! &> /dev/null; then
        echo "[OK] MariaDB est prêt"
        break
    fi
    echo "  - Tentative $i/30..."
    sleep 2
done

# Attendre que l'application soit prête
echo "[INFO] Attente de LogSystem..."
for i in {1..30}; do
    if curl -f http://localhost:10000/health &> /dev/null; then
        echo "[OK] LogSystem est prêt"
        break
    fi
    echo "  - Tentative $i/30..."
    sleep 2
done

echo ""
echo "========================================"
echo "✓ LogSystem est démarré avec succès !"
echo "========================================"
echo ""
echo "Accès:"
echo "  - Application: http://localhost:10000"
echo "  - Login par défaut:"
echo "    Email: admin@logsystem.local"
echo "    Mot de passe: CHANGE_THIS_STRONG_PASSWORD_IMMEDIATELY"
echo ""
echo "Commandes utiles:"
echo "  - Voir les logs: docker-compose logs -f"
echo "  - Arrêter: docker-compose down"
echo "  - Redémarrer: docker-compose restart"
echo "  - Accéder à MariaDB: docker exec -it logsystem-mariadb mariadb -u root -p"
echo ""
