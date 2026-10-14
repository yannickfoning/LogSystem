# Test Fonctionnel Docker - LogSystem
# Ce script teste toutes les fonctionnalités de la plateforme Docker

$ErrorActionPreference = "Stop"
$TestResults = @()
$TestStartTime = Get-Date
$BaseUrl = "http://localhost:10000"

# Fonction pour logger les résultats
function Log-TestResult {
    param(
        [string]$TestName,
        [bool]$Passed,
        [string]$Details = ""
    )
    
    $result = [PSCustomObject]@{
        Test = $TestName
        Status = if ($Passed) { "✅ PASS" } else { "❌ FAIL" }
        Details = $Details
        Timestamp = Get-Date
    }
    
    $script:TestResults += $result
    Write-Host "$($result.Status) - $TestName" -ForegroundColor $(if ($Passed) { "Green" } else { "Red" })
    if ($Details) {
        Write-Host "   $Details" -ForegroundColor "Gray"
    }
}

Write-Host "======================================================" -ForegroundColor "Cyan"
Write-Host "  TEST FONCTIONNEL DOCKER - LOGSYSTEM" -ForegroundColor "Cyan"
Write-Host "======================================================" -ForegroundColor "Cyan"
Write-Host ""

# Test 1: Vérifier que les services Docker sont actifs
Write-Host "MODULE 1: SERVICES DOCKER" -ForegroundColor "Yellow"
Write-Host "----------------------------------------" -ForegroundColor "Yellow"

$dockerPs = docker-compose ps
if ($dockerPs -match "Up") {
    Log-TestResult -TestName "Services Docker actifs" -Passed $true -Details "Conteneurs en cours d'exécution"
} else {
    Log-TestResult -TestName "Services Docker actifs" -Passed $false -Details "Conteneurs non actifs"
    exit 1
}

# Vérifier MySQL
if ($dockerPs -match "mysql.*healthy") {
    Log-TestResult -TestName "MySQL healthy" -Passed $true -Details "Base de données prête"
} else {
    Log-TestResult -TestName "MySQL healthy" -Passed $false -Details "MySQL non healthy"
}

# Vérifier Redis
if ($dockerPs -match "redis.*healthy") {
    Log-TestResult -TestName "Redis healthy" -Passed $true -Details "Cache prêt"
} else {
    Log-TestResult -TestName "Redis healthy" -Passed $false -Details "Redis non healthy"
}

Write-Host ""

# Test 2: Logs du serveur
Write-Host "MODULE 2: LOGS SERVEUR" -ForegroundColor "Yellow"
Write-Host "----------------------------------------" -ForegroundColor "Yellow"

$serverLogs = docker-compose logs app --tail 100
if ($serverLogs -match "server_started") {
    Log-TestResult -TestName "Serveur démarré" -Passed $true -Details "Serveur HTTP actif"
} else {
    Log-TestResult -TestName "Serveur démarré" -Passed $false -Details "Serveur non démarré"
}

if ($serverLogs -match "migration_completed") {
    Log-TestResult -TestName "Migrations terminées" -Passed $true -Details "Schema à jour"
} else {
    Log-TestResult -TestName "Migrations terminées" -Passed $false -Details "Migrations échouées"
}

if ($serverLogs -match "redis_connected") {
    Log-TestResult -TestName "Redis connecté" -Passed $true -Details "Cache connecté"
} else {
    Log-TestResult -TestName "Redis connecté" -Passed $false -Details "Redis non connecté"
}

# Vérifier les erreurs
$errorCount = ($serverLogs | Select-String -Pattern "level:50" | Measure-Object).Count
if ($errorCount -eq 0) {
    Log-TestResult -TestName "Pas d'erreurs critiques" -Passed $true -Details "Logs propres"
} else {
    Log-TestResult -TestName "Pas d'erreurs critiques" -Passed $false -Details "$errorCount erreurs détectées"
}

Write-Host ""

# Test 3: Connexion HTTP
Write-Host "MODULE 3: CONNEXION HTTP" -ForegroundColor "Yellow"
Write-Host "----------------------------------------" -ForegroundColor "Yellow"

$maxAttempts = 5
$attempt = 0
$httpConnected = $false

while ($attempt -lt $maxAttempts -and -not $httpConnected) {
    $attempt++
    Write-Host "   Tentative $attempt/$maxAttempts..." -ForegroundColor "Gray"
    try {
        $response = Invoke-WebRequest -Uri "$BaseUrl/login.html" -UseBasicParsing -TimeoutSec 5
        if ($response.StatusCode -eq 200) {
            $httpConnected = $true
            Log-TestResult -TestName "Login page accessible" -Passed $true -Details "HTTP 200 OK"
        }
    } catch {
        Start-Sleep -Seconds 3
    }
}

if (-not $httpConnected) {
    Log-TestResult -TestName "Login page accessible" -Passed $false -Details "Application non accessible"
    Write-Host ""
    Write-Host "Logs récents:" -ForegroundColor "Yellow"
    docker-compose logs app --tail 20
    exit 1
}

Write-Host ""

# Test 4: Authentification
Write-Host "MODULE 4: AUTHENTIFICATION" -ForegroundColor "Yellow"
Write-Host "----------------------------------------" -ForegroundColor "Yellow"

try {
    $loginBody = @{
        email = "admin@logsystem.local"
        password = "Admin@1234"
    } | ConvertTo-Json
    
    $loginResponse = Invoke-WebRequest -Uri "$BaseUrl/api/auth/login" `
        -Method POST `
        -ContentType "application/json" `
        -Body $loginBody `
        -UseBasicParsing `
        -SessionVariable session
    
    if ($loginResponse.StatusCode -eq 200) {
        Log-TestResult -TestName "Login admin" -Passed $true -Details "Authentification réussie"
        
        $cookies = $session.Cookies.GetCookies($BaseUrl)
        $sessionId = ($cookies | Where-Object { $_.Name -eq "connect.sid" }).Value
        $csrfToken = ($cookies | Where-Object { $_.Name -eq "csrf_token" }).Value
        
        if ($sessionId -and $csrfToken) {
            Log-TestResult -TestName "Cookies générés" -Passed $true -Details "Session et CSRF créés"
            
            # Test session persistence
            $meResponse = Invoke-WebRequest -Uri "$BaseUrl/api/auth/me" `
                -Method GET `
                -WebSession $session `
                -UseBasicParsing
            
            if ($meResponse.StatusCode -eq 200) {
                Log-TestResult -TestName "Session persistence" -Passed $true -Details "Session active"
            } else {
                Log-TestResult -TestName "Session persistence" -Passed $false -Details "Session non persistante"
            }
        } else {
            Log-TestResult -TestName "Cookies générés" -Passed $false -Details "Cookies manquants"
        }
    } else {
        Log-TestResult -TestName "Login admin" -Passed $false -Details "Login échoué"
    }
} catch {
    Log-TestResult -TestName "Login admin" -Passed $false -Details "Erreur: $($_.Exception.Message)"
}

Write-Host ""

# Test 5: Dashboard API
Write-Host "MODULE 5: DASHBOARD API" -ForegroundColor "Yellow"
Write-Host "----------------------------------------" -ForegroundColor "Yellow"

if ($session) {
    try {
        $summaryResponse = Invoke-WebRequest -Uri "$BaseUrl/api/dashboard/summary" `
            -Method GET `
            -WebSession $session `
            -UseBasicParsing
        
        if ($summaryResponse.StatusCode -eq 200) {
            $summaryData = $summaryResponse.Content | ConvertFrom-Json
            Log-TestResult -TestName "Dashboard Summary" -Passed $true -Details "Total logs: $($summaryData.total_logs)"
        } else {
            Log-TestResult -TestName "Dashboard Summary" -Passed $false -Details "Erreur API"
        }
    } catch {
        Log-TestResult -TestName "Dashboard Summary" -Passed $false -Details "Erreur: $($_.Exception.Message)"
    }
    
    try {
        $trendsResponse = Invoke-WebRequest -Uri "$BaseUrl/api/dashboard/trends" `
            -Method GET `
            -WebSession $session `
            -UseBasicParsing
        
        if ($trendsResponse.StatusCode -eq 200) {
            $trendsData = $trendsResponse.Content | ConvertFrom-Json
            Log-TestResult -TestName "Dashboard Trends" -Passed $true -Details "Tendances récupérées"
        } else {
            Log-TestResult -TestName "Dashboard Trends" -Passed $false -Details "Erreur API"
        }
    } catch {
        Log-TestResult -TestName "Dashboard Trends" -Passed $false -Details "Erreur: $($_.Exception.Message)"
    }
} else {
    Write-Host "⚠️ Tests Dashboard sautés (pas de session)" -ForegroundColor "Yellow"
}

Write-Host ""

# Test 6: Search API
Write-Host "MODULE 6: SEARCH API" -ForegroundColor "Yellow"
Write-Host "----------------------------------------" -ForegroundColor "Yellow"

if ($session) {
    try {
        $searchResponse = Invoke-WebRequest -Uri "$BaseUrl/api/logs/search" `
            -Method GET `
            -WebSession $session `
            -UseBasicParsing
        
        if ($searchResponse.StatusCode -eq 200) {
            $searchData = $searchResponse.Content | ConvertFrom-Json
            Log-TestResult -TestName "Search sans filtres" -Passed $true -Details "$($searchData.logs.Count) résultats"
        } else {
            Log-TestResult -TestName "Search sans filtres" -Passed $false -Details "Erreur API"
        }
    } catch {
        Log-TestResult -TestName "Search sans filtres" -Passed $false -Details "Erreur: $($_.Exception.Message)"
    }
} else {
    Write-Host "⚠️ Tests Search sautés (pas de session)" -ForegroundColor "Yellow"
}

Write-Host ""

# Test 7: Database Integrity
Write-Host "MODULE 7: DATABASE INTEGRITY" -ForegroundColor "Yellow"
Write-Host "----------------------------------------" -ForegroundColor "Yellow"

try {
    $dbCheck = docker-compose exec -T mysql mysql -u logsystem -pLogSystemDocker2024! logsystem -e "SHOW TABLES;" 2>&1
    if ($dbCheck -match "users") {
        Log-TestResult -TestName "Table users existe" -Passed $true -Details "Schema OK"
    } else {
        Log-TestResult -TestName "Table users existe" -Passed $false -Details "Table manquante"
    }
    
    if ($dbCheck -match "logs") {
        Log-TestResult -TestName "Table logs existe" -Passed $true -Details "Schema OK"
    } else {
        Log-TestResult -TestName "Table logs existe" -Passed $false -Details "Table manquante"
    }
} catch {
    Log-TestResult -TestName "Database integrity" -Passed $false -Details "Erreur: $($_.Exception.Message)"
}

Write-Host ""

# Test 8: Alert Engine
Write-Host "MODULE 8: ALERT ENGINE" -ForegroundColor "Yellow"
Write-Host "----------------------------------------" -ForegroundColor "Yellow"

if ($serverLogs -match "alert_engine_started") {
    Log-TestResult -TestName "Alert engine démarré" -Passed $true -Details "Moteur d'alertes actif"
} else {
    Log-TestResult -TestName "Alert engine démarré" -Passed $false -Details "Moteur non démarré"
}

if ($serverLogs -match "alert_rule_triggered") {
    $alertCount = ($serverLogs | Select-String -Pattern "alert_rule_triggered" | Measure-Object).Count
    Log-TestResult -TestName "Alertes déclenchées" -Passed $true -Details "$alertCount alertes créées"
} else {
    Log-TestResult -TestName "Alertes déclenchées" -Passed $false -Details "Aucune alerte"
}

Write-Host ""

# Test 9: Watcher Service
Write-Host "MODULE 9: WATCHER SERVICE" -ForegroundColor "Yellow"
Write-Host "----------------------------------------" -ForegroundColor "Yellow"

if ($serverLogs -match "watching_directories") {
    Log-TestResult -TestName "Watcher actif" -Passed $true -Details "Surveillance de fichiers active"
} else {
    Log-TestResult -TestName "Watcher actif" -Passed $false -Details "Watcher non actif"
}

if ($serverLogs -match "logs_inserted") {
    $insertCount = ($serverLogs | Select-String -Pattern "logs_inserted" | Measure-Object).Count
    Log-TestResult -TestName "Logs insérés par watcher" -Passed $true -Details "$insertCount logs traités"
} else {
    Log-TestResult -TestName "Logs insérés par watcher" -Passed $false -Details "Aucun log traité"
}

Write-Host ""

# Résumé des tests
Write-Host "======================================================" -ForegroundColor "Cyan"
Write-Host "  RÉSUMÉ DES TESTS" -ForegroundColor "Cyan"
Write-Host "======================================================" -ForegroundColor "Cyan"
Write-Host ""

$passedCount = ($TestResults | Where-Object { $_.Status -eq "✅ PASS" }).Count
$failedCount = ($TestResults | Where-Object { $_.Status -eq "❌ FAIL" }).Count
$totalCount = $TestResults.Count

Write-Host "Total tests: $totalCount" -ForegroundColor "White"
Write-Host "Réussis: $passedCount" -ForegroundColor "Green"
Write-Host "Échoués: $failedCount" -ForegroundColor "Red"
Write-Host ""

$successRate = if ($totalCount -gt 0) { [math]::Round(($passedCount / $totalCount) * 100, 2) } else { 0 }
Write-Host "Taux de réussite: $successRate%" -ForegroundColor $(if ($successRate -ge 80) { "Green" } elseif ($successRate -ge 50) { "Yellow" } else { "Red" })
Write-Host ""

# Détails des tests échoués
if ($failedCount -gt 0) {
    Write-Host "Tests échoués:" -ForegroundColor "Red"
    Write-Host "----------------------------------------" -ForegroundColor "Red"
    $TestResults | Where-Object { $_.Status -eq "❌ FAIL" } | ForEach-Object {
        Write-Host "  ❌ $($_.Test)" -ForegroundColor "Red"
        Write-Host "     $($_.Details)" -ForegroundColor "Gray"
    }
    Write-Host ""
}

# Durée du test
$testDuration = (Get-Date) - $TestStartTime
Write-Host "Durée totale: $($testDuration.ToString('mm\:ss'))" -ForegroundColor "Cyan"
Write-Host ""

# Rapport final
if ($failedCount -eq 0) {
    Write-Host "🎉 TOUS LES TESTS ONT RÉUSSI!" -ForegroundColor "Green"
    Write-Host "La plateforme Docker fonctionne correctement." -ForegroundColor "Green"
    exit 0
} elseif ($successRate -ge 80) {
    Write-Host "⚠️ Tests majoritairement réussis mais quelques problèmes détectés" -ForegroundColor "Yellow"
    exit 1
} else {
    Write-Host "❌ Tests en échec - La plateforme nécessite des corrections" -ForegroundColor "Red"
    exit 1
}
