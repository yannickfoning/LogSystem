# Script pour accéder au shell d'un conteneur Docker

$ErrorActionPreference = "Stop"

$service = if ($args.Count -gt 0) { $args[0] } else { "app" }

# Charger les variables d'environnement depuis .env.docker
if (Test-Path ".env.docker") {
    Get-Content ".env.docker" | ForEach-Object {
        if ($_ -match "^([^=]+)=(.*)$") {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
        }
    }
}

$dbPassword = $env:DB_PASSWORD
$redisPassword = $env:REDIS_PASSWORD

Write-Host "======================================================" -ForegroundColor "Cyan"
Write-Host "  LOGSYSTEM - DOCKER SHELL" -ForegroundColor "Cyan"
Write-Host "======================================================" -ForegroundColor "Cyan"
Write-Host ""

Write-Host "Accès au shell du conteneur: $service" -ForegroundColor "Yellow"
Write-Host "Utilisation: .\docker-shell.ps1 [app|mysql|redis]" -ForegroundColor "Gray"
Write-Host ""

try {
    if ($service -eq "mysql") {
        docker compose --env-file .env.docker exec mysql mysql -u logsystem -p$dbPassword logsystem
    } elseif ($service -eq "redis") {
        docker compose --env-file .env.docker exec redis redis-cli -a $redisPassword
    } else {
        docker compose --env-file .env.docker exec app sh
    }
} catch {
    Write-Host "❌ Erreur lors de l'accès au conteneur" -ForegroundColor "Red"
    Write-Host "Erreur: $($_.Exception.Message)" -ForegroundColor "Red"
    exit 1
}
