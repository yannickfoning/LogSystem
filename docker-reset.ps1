# Script pour réinitialiser complètement les services Docker LogSystem
# ⚠️ ATTENTION: Cela supprime toutes les données (volumes)

$ErrorActionPreference = "Stop"

Write-Host "======================================================" -ForegroundColor "Red"
Write-Host "  LOGSYSTEM - DOCKER RESET" -ForegroundColor "Red"
Write-Host "  ⚠️  CECI SUPPRIMERA TOUTES LES DONNÉES" -ForegroundColor "Red"
Write-Host "======================================================" -ForegroundColor "Red"
Write-Host ""

$confirmation = Read-Host "Êtes-vous sûr de vouloir continuer? (oui/non)"
if ($confirmation -ne "oui") {
    Write-Host "Opération annulée" -ForegroundColor "Yellow"
    exit 0
}

Write-Host ""
Write-Host "Arrêt et suppression des conteneurs et volumes..." -ForegroundColor "Yellow"
try {
    docker compose --env-file .env.docker down -v
    Write-Host "✅ Conteneurs et volumes supprimés" -ForegroundColor "Green"
} catch {
    Write-Host "❌ Erreur lors de la suppression" -ForegroundColor "Red"
    Write-Host "Erreur: $($_.Exception.Message)" -ForegroundColor "Red"
    exit 1
}

Write-Host ""
Write-Host "Suppression des images Docker (optionnel)..." -ForegroundColor "Yellow"
$removeImages = Read-Host "Supprimer aussi les images? (oui/non)"
if ($removeImages -eq "oui") {
    try {
        docker compose --env-file .env.docker down -v --rmi all
        Write-Host "✅ Images supprimées" -ForegroundColor "Green"
    } catch {
        Write-Host "⚠️  Erreur lors de la suppression des images" -ForegroundColor "Yellow"
    }
}

Write-Host ""
Write-Host "======================================================" -ForegroundColor "Cyan"
Write-Host "  RESET TERMINÉ" -ForegroundColor "Cyan"
Write-Host "======================================================" -ForegroundColor "Cyan"
Write-Host ""
Write-Host "Pour redémarrer fraîchement:" -ForegroundColor "Cyan"
Write-Host "  .\docker-setup.ps1" -ForegroundColor "White"
Write-Host ""
