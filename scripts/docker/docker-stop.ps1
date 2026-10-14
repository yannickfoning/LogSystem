# Script pour arrêter les services Docker LogSystem

$ErrorActionPreference = "Stop"

Write-Host "======================================================" -ForegroundColor "Cyan"
Write-Host "  LOGSYSTEM - DOCKER STOP" -ForegroundColor "Cyan"
Write-Host "======================================================" -ForegroundColor "Cyan"
Write-Host ""

Write-Host "Arrêt des services Docker..." -ForegroundColor "Yellow"
try {
    docker compose --env-file .env.docker down
    Write-Host "✅ Services arrêtés avec succès" -ForegroundColor "Green"
} catch {
    Write-Host "❌ Erreur lors de l'arrêt des services" -ForegroundColor "Red"
    Write-Host "Erreur: $($_.Exception.Message)" -ForegroundColor "Red"
    exit 1
}

Write-Host ""
Write-Host "Pour supprimer les volumes (attention: données perdues):" -ForegroundColor "Yellow"
Write-Host "  docker compose --env-file .env.docker down -v" -ForegroundColor "Cyan"
Write-Host ""
