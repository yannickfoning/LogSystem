# Script de setup Docker pour LogSystem
# Ce script configure et lance l'application avec Docker Compose

$ErrorActionPreference = "Stop"

Write-Host "======================================================" -ForegroundColor "Cyan"
Write-Host "  LOGSYSTEM - DOCKER SETUP" -ForegroundColor "Cyan"
Write-Host "======================================================" -ForegroundColor "Cyan"
Write-Host ""

# Vérifier que Docker est installé
Write-Host "1. Vérification de Docker..." -ForegroundColor "Yellow"
try {
    $dockerVersion = docker --version
    Write-Host "   ✅ Docker installé: $dockerVersion" -ForegroundColor "Green"
} catch {
    Write-Host "   ❌ Docker n'est pas installé ou non accessible" -ForegroundColor "Red"
    Write-Host "   Veuillez installer Docker Desktop: https://www.docker.com/products/docker-desktop" -ForegroundColor "Yellow"
    exit 1
}

# Vérifier que Docker Compose est disponible
Write-Host "2. Vérification de Docker Compose..." -ForegroundColor "Yellow"
try {
    $composeVersion = docker compose version
    Write-Host "   ✅ Docker Compose installé: $composeVersion" -ForegroundColor "Green"
} catch {
    Write-Host "   ❌ Docker Compose n'est pas installé" -ForegroundColor "Red"
    Write-Host "   Docker Compose est inclus avec Docker Desktop" -ForegroundColor "Yellow"
    exit 1
}

Write-Host ""

# Vérifier que .env.docker existe
Write-Host "3. Vérification de la configuration..." -ForegroundColor "Yellow"
if (-not (Test-Path ".env.docker")) {
    Write-Host "   ❌ Fichier .env.docker manquant" -ForegroundColor "Red"
    exit 1
}
Write-Host "   ✅ Fichier .env.docker trouvé" -ForegroundColor "Green"

# Vérifier le fichier docker-compose.yml
if (-not (Test-Path "docker-compose.yml")) {
    Write-Host "   ❌ Fichier docker-compose.yml manquant" -ForegroundColor "Red"
    exit 1
}
Write-Host "   ✅ Fichier docker-compose.yml trouvé" -ForegroundColor "Green"

Write-Host ""

# Arrêter les conteneurs existants si présents
Write-Host "4. Nettoyage des conteneurs existants..." -ForegroundColor "Yellow"
try {
    docker compose --env-file .env.docker down 2>$null
    Write-Host "   ✅ Conteneurs arrêtés" -ForegroundColor "Green"
} catch {
    Write-Host "   ℹ️  Aucun conteneur existant" -ForegroundColor "Gray"
}

Write-Host ""

# Construire les images
Write-Host "5. Construction des images Docker..." -ForegroundColor "Yellow"
Write-Host "   Cela peut prendre plusieurs minutes..." -ForegroundColor "Gray"
try {
    docker compose --env-file .env.docker build
    Write-Host "   ✅ Images construites avec succès" -ForegroundColor "Green"
} catch {
    Write-Host "   ❌ Erreur lors de la construction des images" -ForegroundColor "Red"
    Write-Host "   Erreur: $($_.Exception.Message)" -ForegroundColor "Red"
    exit 1
}

Write-Host ""

# Démarrer les services
Write-Host "6. Démarrage des services..." -ForegroundColor "Yellow"
try {
    docker compose --env-file .env.docker up -d
    Write-Host "   ✅ Services démarrés" -ForegroundColor "Green"
} catch {
    Write-Host "   ❌ Erreur lors du démarrage des services" -ForegroundColor "Red"
    Write-Host "   Erreur: $($_.Exception.Message)" -ForegroundColor "Red"
    exit 1
}

Write-Host ""

# Attendre que les services soient prêts
Write-Host "7. Attente du démarrage des services..." -ForegroundColor "Yellow"
Write-Host "   MySQL et Redis prennent environ 30-60 secondes..." -ForegroundColor "Gray"
Start-Sleep -Seconds 30

# Vérifier l'état des services
Write-Host "8. Vérification de l'état des services..." -ForegroundColor "Yellow"
$services = docker compose --env-file .env.docker ps
Write-Host $services

# Vérifier que l'application est accessible
Write-Host ""
Write-Host "9. Test de connexion à l'application..." -ForegroundColor "Yellow"
$maxAttempts = 10
$attempt = 0
$connected = $false

while ($attempt -lt $maxAttempts -and -not $connected) {
    $attempt++
    Write-Host "   Tentative $attempt/$maxAttempts..." -ForegroundColor "Gray"
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:10000/health" -UseBasicParsing -TimeoutSec 5
        if ($response.StatusCode -eq 200) {
            $connected = $true
            Write-Host "   ✅ Application accessible" -ForegroundColor "Green"
        }
    } catch {
        Start-Sleep -Seconds 5
    }
}

if (-not $connected) {
    Write-Host "   ⚠️  Application non accessible après $maxAttempts tentatives" -ForegroundColor "Yellow"
    Write-Host "   Vérifiez les logs avec: docker compose --env-file .env.docker logs app" -ForegroundColor "Yellow"
}

Write-Host ""
Write-Host "======================================================" -ForegroundColor "Cyan"
Write-Host "  SETUP TERMINÉ" -ForegroundColor "Cyan"
Write-Host "======================================================" -ForegroundColor "Cyan"
Write-Host ""
Write-Host "Application accessible sur: http://localhost:10000" -ForegroundColor "Green"
Write-Host ""
Write-Host "Commandes utiles:" -ForegroundColor "Cyan"
Write-Host "  - Voir les logs: docker compose --env-file .env.docker logs -f" -ForegroundColor "White"
Write-Host "  - Arrêter les services: docker compose --env-file .env.docker down" -ForegroundColor "White"
Write-Host "  - Redémarrer: docker compose --env-file .env.docker restart" -ForegroundColor "White"
Write-Host "  - Voir l'état: docker compose --env-file .env.docker ps" -ForegroundColor "White"
Write-Host ""
Write-Host "Identifiants par défaut:" -ForegroundColor "Cyan"
Write-Host "  Admin: admin@logsystem.local / Admin@1234" -ForegroundColor "White"
Write-Host "  User:  user@logsystem.local  / User@1234" -ForegroundColor "White"
Write-Host ""
