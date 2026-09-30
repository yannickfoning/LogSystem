# Test fonctionnel complet des améliorations du cahier des charges
# Utilise curl pour tester directement les API endpoints

$ErrorActionPreference = "Stop"
$BaseUrl = "http://localhost:10000"
$SessionCookie = ""

Write-Host "🚀 Démarrage des tests fonctionnels complets..." -ForegroundColor Green
Write-Host ""

# Fonction pour faire des requêtes HTTP
function Invoke-ApiRequest {
    param(
        [string]$Method,
        [string]$Path,
        [hashtable]$Data = $null,
        [string]$Cookie = ""
    )
    
    $url = "$BaseUrl$Path"
    $headers = @{}
    
    if ($Cookie) {
        $headers["Cookie"] = $Cookie
    }
    
    try {
        if ($Data) {
            $body = $Data | ConvertTo-Json
            $response = Invoke-WebRequest -Uri $url -Method $Method -Body $body -ContentType "application/json" -Headers $headers -UseBasicParsing
        } else {
            $response = Invoke-WebRequest -Uri $url -Method $Method -Headers $headers -UseBasicParsing
        }
        
        return @{
            StatusCode = $response.StatusCode
            Body = $response.Content | ConvertFrom-Json
            Headers = $response.Headers
        }
    } catch {
        $errorResponse = $_.ErrorDetails.Message | ConvertFrom-Json
        return @{
            StatusCode = $_.Exception.Response.StatusCode.value__
            Body = $errorResponse
            Headers = @{}
        }
    }
}

# Test d'authentification
function Test-Authentication {
    Write-Host "🔐 Test d'authentification..." -ForegroundColor Yellow
    
    $loginData = @{
        email = "admin@logsystem.local"
        password = "Admin@1234"
    }
    
    $response = Invoke-ApiRequest -Method "POST" -Path "/api/auth/login" -Data $loginData
    
    if ($response.StatusCode -eq 200) {
        # Extraire le cookie de session
        $setCookie = $response.Headers["Set-Cookie"]
        if ($setCookie) {
            # Handle array of Set-Cookie headers
            if ($setCookie -is [array]) {
                $setCookie = $setCookie -join ", "
            }
            
            # Extract only the connect.sid cookie (session cookie)
            $sessionMatch = $setCookie | Select-String -Pattern "connect\.sid=([^;]+)"
            
            if ($sessionMatch) {
                $global:SessionCookie = "connect.sid=" + $sessionMatch.Matches[0].Groups[1].Value
                Write-Host "✅ Authentification réussie" -ForegroundColor Green
                return $true
            } else {
                Write-Host "❌ Impossible d'extraire connect.sid du Set-Cookie" -ForegroundColor Red
                return $false
            }
        } else {
            Write-Host "❌ Pas de header Set-Cookie trouvé" -ForegroundColor Red
            return $false
        }
    }
    
    Write-Host "❌ Authentification échouée: $($response.StatusCode)" -ForegroundColor Red
    return $false
}

# Test 1: Filtres du dashboard
function Test-DashboardFilters {
    Write-Host ""
    Write-Host "🎨 Test des filtres du dashboard..." -ForegroundColor Yellow
    
    $tests = @(
        @{ Name = "Filtre par niveau"; Params = "?level=ERROR" },
        @{ Name = "Filtre par plateforme"; Params = "?platform=Production" },
        @{ Name = "Filtre par type de source"; Params = "?sourceType=import" },
        @{ Name = "Filtre par répertoire"; Params = "?directory=/var/log" },
        @{ Name = "Filtre par service"; Params = "?service=auth" },
        @{ Name = "Filtre par période"; Params = "?timeRange=24h" },
        @{ Name = "Filtre combiné"; Params = "?level=ERROR&platform=Production&timeRange=24h" }
    )
    
    $passed = 0
    foreach ($test in $tests) {
        $response = Invoke-ApiRequest -Method "GET" -Path "/api/dashboard/recent-logs$($test.Params)" -Cookie $global:SessionCookie
        
        if ($response.StatusCode -eq 200) {
            Write-Host "✅ $($test.Name): $($response.StatusCode)" -ForegroundColor Green
            $passed++
        } else {
            Write-Host "❌ $($test.Name): $($response.StatusCode)" -ForegroundColor Red
        }
    }
    
    Write-Host "📊 Résultat filtres: $passed/$($tests.Count) tests passés" -ForegroundColor Cyan
    return $passed -eq $tests.Count
}

# Test 2: API de partage
function Test-SharingAPI {
    Write-Host ""
    Write-Host "📤 Test de l'API de partage..." -ForegroundColor Yellow
    
    # Récupérer quelques log IDs
    $logsResponse = Invoke-ApiRequest -Method "GET" -Path "/api/dashboard/recent-logs?limit=5" -Cookie $global:SessionCookie
    $logIds = @()
    if ($logsResponse.Body.recentLogs) {
        $logIds = $logsResponse.Body.recentLogs | ForEach-Object { $_.id }
    }
    if ($logIds.Count -eq 0) { $logIds = @(1, 2, 3) }
    
    $tests = @(
        @{ 
            Name = "Configuration de partage"
            Method = "GET"
            Path = "/api/share/config"
            Data = $null
        },
        @{ 
            Name = "Partage par email"
            Method = "POST"
            Path = "/api/share/email"
            Data = @{
                emailTo = "test@example.com"
                logIds = $logIds
                subject = "Test LogSystem Export"
            }
        },
        @{ 
            Name = "Partage par WhatsApp"
            Method = "POST"
            Path = "/api/share/whatsapp"
            Data = @{
                phoneNumber = "+33612345678"
                logIds = $logIds
                message = "Test LogSystem Export"
            }
        },
        @{ 
            Name = "Génération de lien partageable"
            Method = "POST"
            Path = "/api/share/link"
            Data = @{
                logIds = $logIds
                expiresHours = 24
            }
        }
    )
    
    $passed = 0
    foreach ($test in $tests) {
        $response = Invoke-ApiRequest -Method $test.Method -Path $test.Path -Data $test.Data -Cookie $global:SessionCookie
        
        if ($response.StatusCode -eq 200) {
            Write-Host "✅ $($test.Name): $($response.StatusCode)" -ForegroundColor Green
            $passed++
        } else {
            Write-Host "❌ $($test.Name): $($response.StatusCode)" -ForegroundColor Red
        }
    }
    
    Write-Host "📊 Résultat partage: $passed/$($tests.Count) tests passés" -ForegroundColor Cyan
    return $passed -eq $tests.Count
}

# Test 3: Alert automation avec retry
function Test-AlertAutomation {
    Write-Host ""
    Write-Host "🚨 Test de l'alert automation avec retry..." -ForegroundColor Yellow
    
    $tests = @(
        @{ Name = "Récupérer les alertes"; Path = "/api/dashboard/alerts" },
        @{ Name = "Alertes critiques uniquement"; Path = "/api/dashboard/alerts/critical-only" },
        @{ Name = "Alertes groupées"; Path = "/api/dashboard/alerts/grouped" },
        @{ Name = "Alertes système uniquement"; Path = "/api/dashboard/alerts/system-only" }
    )
    
    $passed = 0
    foreach ($test in $tests) {
        $response = Invoke-ApiRequest -Method "GET" -Path $test.Path -Cookie $global:SessionCookie
        
        if ($response.StatusCode -eq 200) {
            Write-Host "✅ $($test.Name): $($response.StatusCode)" -ForegroundColor Green
            $passed++
        } else {
            Write-Host "❌ $($test.Name): $($response.StatusCode)" -ForegroundColor Red
        }
    }
    
    Write-Host "📊 Résultat alert automation: $passed/$($tests.Count) tests passés" -ForegroundColor Cyan
    return $passed -eq $tests.Count
}

# Test 4: Corrections de bugs (API codes, search)
function Test-BugFixes {
    Write-Host ""
    Write-Host "🐛 Test des corrections de bugs..." -ForegroundColor Yellow
    
    $tests = @(
        @{ Name = "Recherche standard"; Path = "/api/search?query=error&limit=10" },
        @{ Name = "Recherche avec filtre niveau"; Path = "/api/search?query=error&level=ERROR&limit=10" },
        @{ Name = "Métadonnées de recherche"; Path = "/api/search/metadata" },
        @{ Name = "Tendances de recherche"; Path = "/api/search/trends?window_hours=24" }
    )
    
    $passed = 0
    foreach ($test in $tests) {
        $response = Invoke-ApiRequest -Method "GET" -Path $test.Path -Cookie $global:SessionCookie
        
        if ($response.StatusCode -eq 200) {
            Write-Host "✅ $($test.Name): $($response.StatusCode)" -ForegroundColor Green
            $passed++
        } else {
            Write-Host "❌ $($test.Name): $($response.StatusCode)" -ForegroundColor Red
        }
    }
    
    Write-Host "📊 Résultat corrections bugs: $passed/$($tests.Count) tests passés" -ForegroundColor Cyan
    return $passed -eq $tests.Count
}

# Test 5: Intégrité de la base de données
function Test-DatabaseIntegrity {
    Write-Host ""
    Write-Host "💾 Test de l'intégrité de la base de données..." -ForegroundColor Yellow
    
    $tests = @(
        @{ Name = "Summary API"; Path = "/api/dashboard/summary" },
        @{ Name = "Trends API"; Path = "/api/dashboard/trends?days=7" },
        @{ Name = "Top errors API"; Path = "/api/dashboard/top-errors?limit=10" },
        @{ Name = "Per level API"; Path = "/api/dashboard/per-level" },
        @{ Name = "Today API"; Path = "/api/dashboard/today" }
    )
    
    $passed = 0
    foreach ($test in $tests) {
        $response = Invoke-ApiRequest -Method "GET" -Path $test.Path -Cookie $global:SessionCookie
        
        if ($response.StatusCode -eq 200) {
            Write-Host "✅ $($test.Name): $($response.StatusCode)" -ForegroundColor Green
            $passed++
        } else {
            Write-Host "❌ $($test.Name): $($response.StatusCode)" -ForegroundColor Red
        }
    }
    
    Write-Host "📊 Résultat intégrité DB: $passed/$($tests.Count) tests passés" -ForegroundColor Cyan
    return $passed -eq $tests.Count
}

# Test principal
function Run-AllTests {
    $authSuccess = Test-Authentication
    if (-not $authSuccess) {
        Write-Host "❌ Impossible de continuer sans authentification" -ForegroundColor Red
        return
    }
    
    $results = @{
        DashboardFilters = Test-DashboardFilters
        SharingAPI = Test-SharingAPI
        AlertAutomation = Test-AlertAutomation
        BugFixes = Test-BugFixes
        DatabaseIntegrity = Test-DatabaseIntegrity
    }
    
    Write-Host ""
    Write-Host "📋 RÉSUMÉ FINAL DES TESTS:" -ForegroundColor Magenta
    Write-Host "==================================================" -ForegroundColor Magenta
    
    foreach ($test in $results.Keys) {
        $status = if ($results[$test]) { "✅ PASSÉ" } else { "❌ ÉCHOUÉ" }
        $color = if ($results[$test]) { "Green" } else { "Red" }
        Write-Host "$($test.PadRight(25)): $status" -ForegroundColor $color
    }
    
    $totalPassed = ($results.Values | Where-Object { $_ }).Count
    $totalTests = $results.Count
    
    Write-Host "==================================================" -ForegroundColor Magenta
    Write-Host "🎯 Score final: $totalPassed/$totalTests catégories de tests réussies" -ForegroundColor Cyan
    
    if ($totalPassed -eq $totalTests) {
        Write-Host "🎉 Tous les tests fonctionnels sont passés avec succès !" -ForegroundColor Green
    } else {
        Write-Host "⚠️ Certains tests ont échoué. Vérifiez les logs ci-dessus." -ForegroundColor Yellow
    }
}

# Exécuter les tests
Run-AllTests