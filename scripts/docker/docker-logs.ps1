# Script pour afficher les logs des services Docker LogSystem

$ErrorActionPreference = "Stop"

$service = if ($args.Count -gt 0) { $args[0] } else { "" }

Write-Host "======================================================" -ForegroundColor "Cyan"
Write-Host "  LOGSYSTEM - DOCKER LOGS" -ForegroundColor "Cyan"
Write-Host "======================================================" -ForegroundColor "Cyan"
Write-Host ""

if ($service) {
    Write-Host "Affichage des logs du service: $service" -ForegroundColor "Yellow"
    docker compose --env-file .env.docker logs -f $service
} else {
    Write-Host "Affichage des logs de tous les services" -ForegroundColor "Yellow"
    Write-Host "Utilisation: .\docker-logs.ps1 [app|mysql|redis]" -ForegroundColor "Gray"
    Write-Host ""
    docker compose --env-file .env.docker logs -f
}
