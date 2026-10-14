# Test Fonctionnel Global - LogSystem Platform
# Ce script teste toutes les fonctionnalités principales de la plateforme

$ErrorActionPreference = "Stop"
$BASE_URL = "http://localhost:10000"
$TEST_RESULTS = @()
$TOTAL_TESTS = 0
$PASSED_TESTS = 0
$FAILED_TESTS = 0

function Write-TestResult {
    param(
        [string]$TestName,
        [bool]$Passed,
        [string]$Details = ""
    )
    
    $script:TOTAL_TESTS++
    if ($Passed) {
        $script:PASSED_TESTS++
        Write-Host "✅ $TestName" -ForegroundColor Green
    } else {
        $script:FAILED_TESTS++
        Write-Host "❌ $TestName" -ForegroundColor Red
        if ($Details) {
            Write-Host "   $Details" -ForegroundColor Yellow
        }
    }
    
    $script:TEST_RESULTS += [PSCustomObject]@{
        Test = $TestName
        Status = if ($Passed) { "PASSED" } else { "FAILED" }
        Details = $Details
    }
}

function Invoke-ApiCall {
    param(
        [string]$Endpoint,
        [string]$Method = "GET",
        [hashtable]$Headers = @{},
        [string]$Body = $null
    )
    
    try {
        $params = @{
            Uri = "$BASE_URL$Endpoint"
            Method = $Method
            Headers = $Headers
            UseBasicParsing = $true
        }
        
        if ($Body) {
            $params.Body = $Body
            $params.ContentType = "application/json"
        }
        
        $response = Invoke-WebRequest @params
        return @{
            Success = $true
            StatusCode = $response.StatusCode
            Content = $response.Content
        }
    } catch {
        return @{
            Success = $false
            StatusCode = $_.Exception.Response.StatusCode.value__
            Content = $_.Exception.Message
        }
    }
}

Write-Host "`n" -NoNewline
Write-Host "═══════════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  TEST FONCTIONNEL GLOBAL - LOGSYSTEM PLATFORM v6.0.0" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# ============================================================
# 1. TEST D'AUTHENTIFICATION
# ============================================================
Write-Host "`n1. TEST D'AUTHENTIFICATION" -ForegroundColor Cyan
Write-Host "─" * 80 -ForegroundColor Cyan

$todo_update_1 = $false
$sessionCookie = $null

# Test 1.1: Login avec identifiants valides
$loginBody = @{
    email = "admin@logsystem.local"
    password = "Admin@1234"
} | ConvertTo-Json

$loginResult = Invoke-ApiCall -Endpoint "/api/auth/login" -Method "POST" -Body $loginBody
Write-TestResult -TestName "Login avec identifiants valides" -Passed ($loginResult.Success -eq $true) -Details $loginResult.Content

if ($loginResult.Success) {
    # Extraire le cookie de session
    $setCookie = $loginResult.Headers["Set-Cookie"]
    if ($setCookie) {
        $sessionCookie = ($setCookie -split ';')[0]
        $todo_update_1 = $true
    }
    
    # Vérifier la réponse contient les infos utilisateur
    $loginData = $loginResult.Content | ConvertFrom-Json
    $hasUserData = $loginData.id -eq 1 -and $loginData.role -eq "admin"
    Write-TestResult -TestName "Réponse login contient infos utilisateur" -Passed $hasUserData
}

# Test 1.2: Login avec identifiants invalides
$invalidLoginBody = @{
    email = "admin@logsystem.local"
    password = "WrongPassword"
} | ConvertTo-Json

$invalidLoginResult = Invoke-ApiCall -Endpoint "/api/auth/login" -Method "POST" -Body $invalidLoginBody
Write-TestResult -TestName "Login refuse mot de passe incorrect" -Passed ($invalidLoginResult.Success -eq $false)

# Test 1.3: Endpoint /api/me (vérification session)
$headers = @{}
if ($sessionCookie) {
    $headers["Cookie"] = $sessionCookie
}

$meResult = Invoke-ApiCall -Endpoint "/api/auth/me" -Headers $headers
Write-TestResult -TestName "Endpoint /api/me avec session valide" -Passed ($meResult.Success -eq $true)

if ($todo_update_1) {
    $todo_write_path = "D:\COLEPS\code\LogSystem\.todos_temp.json"
    $todo_data = @{
        todos = @(
            @{content = "Test d'authentification (login et session)"; status = "completed"},
            @{content = "Test du dashboard (KPI, tendances, logs récents)"; status = "pending"},
            @{content = "Test de recherche de logs"; status = "pending"},
            @{content = "Test d'import de fichiers logs"; status = "pending"},
            @{content = "Test d'administration (utilisateurs, règles)"; status = "pending"},
            @{content = "Test des alertes (affichage, notification)"; status = "pending"},
            @{content = "Test du monitoring en temps réel"; status = "pending"},
            @{content = "Test des recommandations"; status = "pending"},
            @{content = "Test de partage de logs"; status = "pending"},
            @{content = "Génération du rapport de test"; status = "pending"}
        )
    } | ConvertTo-Json -Depth 10
    $todo_data | Out-File -FilePath $todo_write_path -Encoding UTF8
}

# ============================================================
# 2. TEST DU DASHBOARD
# ============================================================
Write-Host "`n2. TEST DU DASHBOARD" -ForegroundColor Cyan
Write-Host "─" * 80 -ForegroundColor Cyan

# Test 2.1: API KPI
$kpiResult = Invoke-ApiCall -Endpoint "/api/dashboard/kpi" -Headers $headers
Write-TestResult -TestName "API Dashboard KPI" -Passed ($kpiResult.Success -eq $true) -Details $kpiResult.Content

if ($kpiResult.Success) {
    $kpiData = $kpiResult.Content | ConvertFrom-Json
    $hasKPI = $kpiData.total -ge 0
    Write-TestResult -TestName "KPI contient des données" -Passed $hasKPI
}

# Test 2.2: API Trends
$trendsResult = Invoke-ApiCall -Endpoint "/api/dashboard/trends?days=1" -Headers $headers
Write-TestResult -TestName "API Dashboard Trends" -Passed ($trendsResult.Success -eq $true) -Details $trendsResult.Content

# Test 2.3: API Logs récents
$logsResult = Invoke-ApiCall -Endpoint "/api/dashboard/recent-logs?limit=10" -Headers $headers
Write-TestResult -TestName "API Logs récents" -Passed ($logsResult.Success -eq $true) -Details $logsResult.Content

if ($logsResult.Success) {
    $logsData = $logsResult.Content | ConvertFrom-Json
    $hasLogs = $logsData.Count -gt 0
    Write-TestResult -TestName "Logs récents retournés" -Passed $hasLogs
}

# Test 2.4: API Level distribution
$levelResult = Invoke-ApiCall -Endpoint "/api/dashboard/level-distribution" -Headers $headers
Write-TestResult -TestName "API Distribution par niveau" -Passed ($levelResult.Success -eq $true)

# Test 2.5: API Top errors
$topErrorsResult = Invoke-ApiCall -Endpoint "/api/dashboard/top-errors" -Headers $headers
Write-TestResult -TestName "API Top Errors" -Passed ($topErrorsResult.Success -eq $true)

# ============================================================
# 3. TEST DE RECHERCHE
# ============================================================
Write-Host "`n3. TEST DE RECHERCHE" -ForegroundColor Cyan
Write-Host "─" * 80 -ForegroundColor Cyan

# Test 3.1: Recherche simple
$searchBody = @{
    query = "ERROR"
    limit = 10
} | ConvertTo-Json

$searchResult = Invoke-ApiCall -Endpoint "/api/search" -Method "POST" -Headers $headers -Body $searchBody
Write-TestResult -TestName "Recherche simple (ERROR)" -Passed ($searchResult.Success -eq $true) -Details $searchResult.Content

# Test 3.2: Recherche avec filtres
$searchFiltersBody = @{
    query = ""
    level = "ERROR"
    limit = 5
} | ConvertTo-Json

$searchFiltersResult = Invoke-ApiCall -Endpoint "/api/search" -Method "POST" -Headers $headers -Body $searchFiltersBody
Write-TestResult -TestName "Recherche avec filtre niveau" -Passed ($searchFiltersResult.Success -eq $true)

# ============================================================
# 4. TEST DES ALERTES
# ============================================================
Write-Host "`n4. TEST DES ALERTES" -ForegroundColor Cyan
Write-Host "─" * 80 -ForegroundColor Cyan

# Test 4.1: Lister les alertes
$alertsResult = Invoke-ApiCall -Endpoint "/api/dashboard/alerts" -Headers $headers
Write-TestResult -TestName "API Lister alertes" -Passed ($alertsResult.Success -eq $true) -Details $alertsResult.Content

# Test 4.2: Marquer alertes comme lues
$markReadBody = @{
    alertIds = @()
} | ConvertTo-Json

$markReadResult = Invoke-ApiCall -Endpoint "/api/dashboard/alerts/mark-read" -Method "POST" -Headers $headers -Body $markReadBody
Write-TestResult -TestName "API Marquer alertes lues" -Passed ($markReadResult.Success -eq $true)

# ============================================================
# 5. TEST D'ADMINISTRATION
# ============================================================
Write-Host "`n5. TEST D'ADMINISTRATION" -ForegroundColor Cyan
Write-Host "─" * 80 -ForegroundColor Cyan

# Test 5.1: Lister les utilisateurs
$usersResult = Invoke-ApiCall -Endpoint "/api/admin/users" -Headers $headers
Write-TestResult -TestName "API Lister utilisateurs" -Passed ($usersResult.Success -eq $true) -Details $usersResult.Content

# Test 5.2: Lister les regles d'alerte
$rulesResult = Invoke-ApiCall -Endpoint "/api/admin/alert-rules" -Headers $headers
Write-TestResult -TestName "API Lister alert rules" -Passed ($rulesResult.Success -eq $true) -Details $rulesResult.Content

# Test 5.3: Stats système
$statsResult = Invoke-ApiCall -Endpoint "/api/admin/stats" -Headers $headers
Write-TestResult -TestName "API Stats système" -Passed ($statsResult.Success -eq $true) -Details $statsResult.Content

# ============================================================
# 6. TEST DES RECOMMANDATIONS
# ============================================================
Write-Host "`n6. TEST DES RECOMMANDATIONS" -ForegroundColor Cyan
Write-Host "─" * 80 -ForegroundColor Cyan

# Test 6.1: Lister les recommandations
$recsResult = Invoke-ApiCall -Endpoint "/api/recommendations" -Headers $headers
Write-TestResult -TestName "API Recommandations" -Passed ($recsResult.Success -eq $true) -Details $recsResult.Content

# ============================================================
# 7. TEST DE WATCHER
# ============================================================
Write-Host "`n7. TEST DE WATCHER" -ForegroundColor Cyan
Write-Host "─" * 80 -ForegroundColor Cyan

# Test 7.1: Status watcher
$watcherResult = Invoke-ApiCall -Endpoint "/api/watchdogs/status" -Headers $headers
Write-TestResult -TestName "API Status Watcher" -Passed ($watcherResult.Success -eq $true) -Details $watcherResult.Content

# ============================================================
# 8. TEST DE LOGOUT
# ============================================================
Write-Host "`n8. TEST DE LOGOUT" -ForegroundColor Cyan
Write-Host "─" * 80 -ForegroundColor Cyan

# Test 8.1: Logout
$logoutResult = Invoke-ApiCall -Endpoint "/api/auth/logout" -Method "POST" -Headers $headers
Write-TestResult -TestName "API Logout" -Passed ($logoutResult.Success -eq $true) -Details $logoutResult.Content

# Test 8.2: Vérifier session invalidée après logout
$meAfterLogout = Invoke-ApiCall -Endpoint "/api/auth/me" -Headers $headers
Write-TestResult -TestName "Session invalidée après logout" -Passed ($meAfterLogout.Success -eq $false)

# ============================================================
# RAPPORT FINAL
# ============================================================
Write-Host "`n" -NoNewline
Write-Host "═══════════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  RAPPORT DE TEST" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

Write-Host "Total tests: $TOTAL_TESTS" -ForegroundColor White
Write-Host "Réussis: $PASSED_TESTS" -ForegroundColor Green
Write-Host "Échoués: $FAILED_TESTS" -ForegroundColor Red

$successRate = if ($TOTAL_TESTS -gt 0) { [math]::Round(($PASSED_TESTS / $TOTAL_TESTS) * 100, 2) } else { 0 }
Write-Host "Taux de réussite: $successRate%" -ForegroundColor Cyan

Write-Host "`nDétails des tests:" -ForegroundColor Cyan
$TEST_RESULTS | Format-Table -AutoSize

# Export des résultats
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$reportFile = "D:\COLEPS\code\LogSystem\test-report-$timestamp.json"
$report = @{
    Timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    TotalTests = $TOTAL_TESTS
    PassedTests = $PASSED_TESTS
    FailedTests = $FAILED_TESTS
    SuccessRate = $successRate
    Results = $TEST_RESULTS
} | ConvertTo-Json -Depth 10

$report | Out-File -FilePath $reportFile -Encoding UTF8
Write-Host "`nRapport exporté: $reportFile" -ForegroundColor Green

# Exit code basé sur les résultats
if ($FAILED_TESTS -eq 0) {
    Write-Host "`n✅ TOUS LES TESTS SONT PASSÉS" -ForegroundColor Green
    exit 0
} else {
    Write-Host "`n❌ CERTAINS TESTS ONT ÉCHOUÉ" -ForegroundColor Red
    exit 1
}
