# Rebuild and recreate only the LogSystem application container.
# Database and Redis containers and their volumes are left untouched.

$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot
$envFile = Join-Path $projectRoot ".env.docker"

if (-not (Test-Path -LiteralPath $envFile)) {
    throw "Missing $envFile. Create it from .env.docker.example and keep the existing database credentials."
}

Push-Location $projectRoot
try {
    $configText = docker-compose --env-file $envFile config --format json
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose could not validate the configuration. Check .env.docker."
    }

    $config = $configText | ConvertFrom-Json
    $app = $config.services.app.environment
    $mysql = $config.services.mysql.environment
    $redisCommand = @($config.services.redis.command)
    $requirePassIndex = [Array]::IndexOf($redisCommand, "--requirepass")

    if ($app.DB_USER -ne $mysql.MYSQL_USER -or
        $app.DB_PASSWORD -ne $mysql.MYSQL_PASSWORD -or
        $app.DB_NAME -ne $mysql.MYSQL_DATABASE) {
        throw "The app and MySQL settings in .env.docker do not match. No containers were changed."
    }

    if ($requirePassIndex -lt 0 -or
        $redisCommand[$requirePassIndex + 1] -ne $app.REDIS_PASSWORD) {
        throw "The app and Redis settings in .env.docker do not match. No containers were changed."
    }

    $dockerContext = (docker context show).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($dockerContext)) {
        throw "Docker could not identify the active context. No containers were changed."
    }

    $buildxOutput = docker buildx ls
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Buildx is unavailable. No containers were changed."
    }
    $builderPrefix = '^\s*' + [regex]::Escape($dockerContext) + '\*?\s+'
    $builder = $buildxOutput | Where-Object { $_ -match $builderPrefix } | Select-Object -First 1
    if (-not $builder) {
        throw "No Buildx builder matches Docker context '$dockerContext'. No containers were changed."
    }

    Write-Host "Building the app image with Docker context '$dockerContext'..." -ForegroundColor Cyan
    docker --context $dockerContext buildx build --builder $dockerContext --load --provenance=false --sbom=false --tag logsystem-app:latest --target runner $projectRoot
    if ($LASTEXITCODE -ne 0) {
        throw "Docker could not build the app image. No containers were changed."
    }

    Write-Host "Recreating only the app container..." -ForegroundColor Cyan
    docker-compose --env-file $envFile up -d --no-deps --force-recreate app
    if ($LASTEXITCODE -ne 0) {
        throw "Docker could not recreate the app container."
    }

    $healthUrl = "http://localhost:$($config.services.app.ports[0].published)/health"
    $healthy = $false
    for ($attempt = 1; $attempt -le 24; $attempt++) {
        try {
            $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 5
            if ($health.status -eq "ok") {
                $healthy = $true
                break
            }
        } catch {
            # The app may still be starting; retry below.
        }
        Start-Sleep -Seconds 5
    }

    if (-not $healthy) {
        Write-Host "The app did not become healthy. Recent app logs:" -ForegroundColor Yellow
        docker-compose --env-file $envFile logs --tail 80 app
        throw "Health check failed at $healthUrl. MySQL and Redis volumes were not modified."
    }

    Write-Host "LogSystem app is healthy at $healthUrl" -ForegroundColor Green
} finally {
    Pop-Location
}
