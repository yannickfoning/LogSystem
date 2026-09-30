# Test fonctionnel des ameliorations LogSystem
$BASE_URL = "http://localhost:10000"
$passed = 0
$failed = 0
$skipped = 0

function Test-Section {
    param([string]$Name)
    Write-Host "`n=== $Name ===" -ForegroundColor Cyan
}

function Test-Step {
    param([string]$Name)
    Write-Host "  -> $Name" -ForegroundColor Yellow
}

function Test-Pass {
    param([string]$Message)
    Write-Host "  PASS: $Message" -ForegroundColor Green
    $script:passed++
}

function Test-Fail {
    param([string]$Message)
    Write-Host "  FAIL: $Message" -ForegroundColor Red
    $script:failed++
}

function Test-Skip {
    param([string]$Message)
    Write-Host "  SKIP: $Message" -ForegroundColor Yellow
    $script:skipped++
}

# Test 1: Serveur accessible
Test-Section "Test 1: Disponibilite du serveur"
Test-Step "Ping du serveur"
try {
    $response = Invoke-WebRequest -Uri "$BASE_URL/health" -UseBasicParsing -TimeoutSec 10
    if ($response.StatusCode -eq 200) {
        Test-Pass "Serveur accessible et healthy"
    } else {
        Test-Fail "Serveur repond avec code $($response.StatusCode)"
    }
} catch {
    Test-Fail "Serveur inaccessible: $($_.Exception.Message)"
}

# Test 2: Filtres dashboard (skip - require auth)
Test-Section "Test 2: Filtres dashboard"
Test-Step "Test filtre plateforme (skip - auth required)"
Test-Skip "Filtres dashboard necessitent authentification"

Test-Step "Test filtre type source (skip - auth required)"
Test-Skip "Filtres dashboard necessitent authentification"

# Test 3: Chart.js SRI
Test-Section "Test 3: Securite Chart.js"
Test-Step "Verifier Chart.js SRI"
try {
    $response = Invoke-WebRequest -Uri "$BASE_URL/dashboard.html" -UseBasicParsing -TimeoutSec 10
    $html = $response.Content
    if ($html -match 'chart.umd.min.js' -and $html -match 'integrity') {
        Test-Pass "Chart.js avec SRI hash present"
    } else {
        Test-Fail "Chart.js SRI manquant"
    }
} catch {
    Test-Fail "Erreur verification Chart.js: $($_.Exception.Message)"
}

# Test 4: Repertoires import
Test-Section "Test 4: Import Worker"
Test-Step "Verifier repertoires"
try {
    $depotExists = Test-Path "uploads/depot"
    $traiteExists = Test-Path "uploads/traité"
    Write-Host "  INFO: Depot existe: $depotExists" -ForegroundColor Gray
    Write-Host "  INFO: Traite existe: $traiteExists" -ForegroundColor Gray
    if ($depotExists -and $traiteExists) {
        Test-Pass "Repertoires d'import crees"
    } else {
        Test-Fail "Repertoires d'import manquants"
    }
} catch {
    Test-Fail "Erreur verification repertoires: $($_.Exception.Message)"
}

# Resume
Test-Section "RESUME"
$total = $passed + $failed + $skipped
Write-Host "`nTotal: $total tests" -ForegroundColor White
Write-Host "Passes: $passed" -ForegroundColor Green
Write-Host "Echoues: $failed" -ForegroundColor Red
Write-Host "Skips: $skipped" -ForegroundColor Yellow

if ($failed -eq 0) {
    Write-Host "`nSUCCESS: Tous les tests passes" -ForegroundColor Green
    exit 0
} else {
    Write-Host "`nFAILURE: Certains tests echoues" -ForegroundColor Red
    exit 1
}
