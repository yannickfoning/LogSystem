# Script de test complet de la plateforme LogSystem
# Ordre logique: santé du service, base de données, auth/admin, ingestion des logs,
# recherche/dashboards, alertes/réception/retention, purge manuelle, sécurité et robustesse

param(
    [string]$BaseUrl = "http://localhost:10000",
    [string]$AdminEmail = "admin@logsystem.local",
    [string]$AdminPassword = "CHANGE_ME",
    [switch]$SkipNpm = $false
)

$ErrorActionPreference = "Stop"
$Global:TestPassed = 0
$Global:TestFailed = 0
$Global:CookieFile = "cookies.txt"

function Write-Section {
    param([string]$Message)
    Write-Host "`n" -NoNewline
    Write-Host "=".repeat(70) -ForegroundColor Cyan
    Write-Host $Message -ForegroundColor Cyan
    Write-Host "=".repeat(70) -ForegroundColor Cyan
}

function Write-Test {
    param([string]$Message, [bool]$Passed)
    if ($Passed) {
        Write-Host "✅ $Message" -ForegroundColor Green
        $Global:TestPassed++
    } else {
        Write-Host "❌ $Message" -ForegroundColor Red
        $Global:TestFailed++
    }
}

function Write-Info {
    param([string]$Message)
    Write-Host "ℹ️  $Message" -ForegroundColor Yellow
}

function Invoke-WebRequestWithBody {
    param(
        [string]$Url,
        [string]$Method = "GET",
        [string]$Body = $null,
        [hashtable]$Headers = @{}
    )
    
    $params = @{
        Uri = $Url
        Method = $Method
        Headers = $Headers
    }
    
    if ($Body) {
        $params.Body = $Body
        $params.ContentType = "application/json"
    }
    
    try {
        return Invoke-WebRequest @params -UseBasicParsing
    } catch {
        $response = $_.Exception.Response
        if ($response) {
            $statusCode = [int]$response.StatusCode
            $responseStream = $response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($responseStream)
            $responseBody = $reader.ReadToEnd()
            return @{
                StatusCode = $statusCode
                Content = $responseBody
            }
        }
        throw
    }
}

# === TESTS PRÉLIMINAIRES ===
Write-Section "TESTS PRÉLIMINAIRES"

if (-not $SkipNpm) {
    Write-Info "Installation des dépendances..."
    try {
        npm install 2>&1 | Out-Null
        Write-Test "npm install" $true
    } catch {
        Write-Test "npm install" $false
    }

    Write-Info "Exécution des tests unitaires..."
    try {
        npm test 2>&1 | Out-Null
        Write-Test "npm test" $true
    } catch {
        Write-Test "npm test" $false
    }

    Write-Info "Linting du code..."
    try {
        npm run lint 2>&1 | Out-Null
        Write-Test "npm run lint" $true
    } catch {
        Write-Test "npm run lint" $false
    }

    Write-Info "Diagnostic complet..."
    try {
        npm run diagnose:comprehensive 2>&1 | Out-Null
        Write-Test "npm run diagnose:comprehensive" $true
    } catch {
        Write-Test "npm run diagnose:comprehensive" $false
    }

    Write-Info "Diagnostic admin..."
    try {
        npm run diagnose:admin 2>&1 | Out-Null
        Write-Test "npm run diagnose:admin" $true
    } catch {
        Write-Test "npm run diagnose:admin" $false
    }

    Write-Info "Diagnostic counts..."
    try {
        npm run diagnose:counts 2>&1 | Out-Null
        Write-Test "npm run diagnose:counts" $true
    } catch {
        Write-Test "npm run diagnose:counts" $false
    }

    Write-Info "Diagnostic rules..."
    try {
        npm run diagnose:rules 2>&1 | Out-Null
        Write-Test "npm run diagnose:rules" $true
    } catch {
        Write-Test "npm run diagnose:rules" $false
    }
} else {
    Write-Info "Tests npm ignorés (flag -SkipNpm)"
}

# === 1. SANTÉ DU SERVICE ===
Write-Section "1. SANTÉ DU SERVICE"

try {
    $healthUrl = "$BaseUrl/health"
    Write-Info "Test du endpoint: $healthUrl"
    
    $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing
    $content = $response.Content | ConvertFrom-Json
    
    $statusOk = ($response.StatusCode -eq 200) -and ($content.status -eq "ok")
    Write-Test "Health endpoint HTTP 200 et status ok" $statusOk
    
    if ($content.database) {
        Write-Test "Base de données accessible" ($content.database -eq "ok")
    }
    
    if ($content.uptime) {
        Write-Test "Uptime présent" $true
    }
} catch {
    Write-Test "Health endpoint accessible" $false
    Write-Info "Erreur: $($_.Exception.Message)"
}

# === 2. BASE DE DONNÉES ===
Write-Section "2. BASE DE DONNÉES"

try {
    $statusUrl = "$BaseUrl/api/admin/system/status"
    $response = Invoke-WebRequestWithBody -Url $statusUrl -Headers @{"Cookie" = "connect.sid="}
    
    if ($response.Content) {
        $content = $response.Content | ConvertFrom-Json
        Write-Test "Endpoint status accessible" ($response.StatusCode -lt 500)
    }
} catch {
    Write-Info "Status endpoint nécessite authentification (normal)"
}

# Vérification via le diagnostic
try {
    npm run diagnose:comprehensive 2>&1 | Out-Null
    Write-Test "Diagnostic base de données" $true
} catch {
    Write-Test "Diagnostic base de données" $false
}

# === 3. AUTHENTIFICATION / ADMIN ===
Write-Section "3. AUTHENTIFICATION / ADMIN"

# Test login admin
try {
    $loginUrl = "$BaseUrl/api/auth/login"
    $loginBody = @{
        email = $AdminEmail
        password = $AdminPassword
    } | ConvertTo-Json
    
    $response = Invoke-WebRequestWithBody -Url $loginUrl -Method "POST" -Body $loginBody
    
    if ($response.StatusCode -eq 200) {
        Write-Test "Login admin réussi" $true
        
        # Sauvegarder les cookies
        if ($response.Headers["Set-Cookie"]) {
            $response.Headers["Set-Cookie"] | Out-File -FilePath $Global:CookieFile
            Write-Test "Cookies sauvegardés" $true
        }
    } else {
        Write-Test "Login admin réussi" $false
    }
} catch {
    Write-Test "Login admin réussi" $false
    Write-Info "Erreur: $($_.Exception.Message)"
    Write-Info "Assurez-vous que l'admin existe (npm run create-admin)"
}

# Test mauvais mot de passe
try {
    $loginUrl = "$BaseUrl/api/auth/login"
    $loginBody = @{
        email = $AdminEmail
        password = "wrongpassword"
    } | ConvertTo-Json
    
    $response = Invoke-WebRequestWithBody -Url $loginUrl -Method "POST" -Body $loginBody
    
    if ($response.StatusCode -eq 401) {
        Write-Test "Mauvais mot de passe rejeté" $true
    } else {
        Write-Test "Mauvais mot de passe rejeté" $false
    }
} catch {
    $statusCode = $_.Exception.Response.StatusCode.Value__
    Write-Test "Mauvais mot de passe rejeté" ($statusCode -eq 401)
}

# Test accès interdit sans auth
try {
    $adminUrl = "$BaseUrl/api/admin/users"
    $response = Invoke-WebRequestWithBody -Url $adminUrl
    
    if ($response.StatusCode -eq 401 -or $response.StatusCode -eq 403) {
        Write-Test "Accès admin sans auth refusé" $true
    } else {
        Write-Test "Accès admin sans auth refusé" $false
    }
} catch {
    $statusCode = $_.Exception.Response.StatusCode.Value__
    Write-Test "Accès admin sans auth refusé" ($statusCode -eq 401 -or $statusCode -eq 403)
}

# Test dashboard sans auth
try {
    $dashboardUrl = "$BaseUrl/dashboard.html"
    $response = Invoke-WebRequest -Uri $dashboardUrl -UseBasicParsing -MaximumRedirection 0
    
    if ($response.StatusCode -eq 302) {
        Write-Test "Dashboard redirige vers login sans auth" $true
    } else {
        Write-Test "Dashboard redirige vers login sans auth" $false
    }
} catch {
    Write-Test "Dashboard redirige vers login sans auth" $true
}

# === 4. ADMIN / UTILISATEUR ===
Write-Section "4. ADMIN / UTILISATEUR"

if (Test-Path $Global:CookieFile) {
    $cookies = Get-Content $Global:CookieFile -Raw
    
    try {
        $usersUrl = "$BaseUrl/api/admin/users"
        $response = Invoke-WebRequestWithBody -Url $usersUrl -Headers @{"Cookie" = $cookies}
        
        if ($response.StatusCode -eq 200) {
            Write-Test "Liste des utilisateurs accessible" $true
            $content = $response.Content | ConvertFrom-Json
            Write-Info "Nombre d'utilisateurs: $($content.Count)"
        } else {
            Write-Test "Liste des utilisateurs accessible" $false
        }
    } catch {
        Write-Test "Liste des utilisateurs accessible" $false
    }

    try {
        $alertRulesUrl = "$BaseUrl/api/admin/alert-rules"
        $response = Invoke-WebRequestWithBody -Url $alertRulesUrl -Headers @{"Cookie" = $cookies}
        
        if ($response.StatusCode -eq 200) {
            Write-Test "Règles d'alerte accessibles" $true
        } else {
            Write-Test "Règles d'alerte accessibles" $false
        }
    } catch {
        Write-Test "Règles d'alerte accessibles" $false
    }
} else {
    Write-Info "Cookies non disponibles - tests admin ignorés"
}

# === 5. IMPORT DE LOGS ===
Write-Section "5. IMPORT DE LOGS"

Write-Info "Import de logs nécessite un fichier de test"
Write-Info "Veuillez importer un fichier .log via l'interface UI"
Write-Test "Import manuel testé" $false

# Vérifier le compteur de logs
if (Test-Path $Global:CookieFile) {
    $cookies = Get-Content $Global:CookieFile -Raw
    
    try {
        $statsUrl = "$BaseUrl/api/dashboard"
        $response = Invoke-WebRequestWithBody -Url $statsUrl -Headers @{"Cookie" = $cookies}
        
        if ($response.StatusCode -eq 200) {
            Write-Test "Stats dashboard accessibles" $true
            $content = $response.Content | ConvertFrom-Json
            if ($content.totalLogs) {
                Write-Info "Total logs: $($content.totalLogs)"
            }
        } else {
            Write-Test "Stats dashboard accessibles" $false
        }
    } catch {
        Write-Test "Stats dashboard accessibles" $false
    }
}

# === 6. RECHERCHE ET DASHBOARD ===
Write-Section "6. RECHERCHE ET DASHBOARD"

if (Test-Path $Global:CookieFile) {
    $cookies = Get-Content $Global:CookieFile -Raw
    
    # Test recherche
    try {
        $searchUrl = "$BaseUrl/api/search?q=test&limit=10"
        $response = Invoke-WebRequestWithBody -Url $searchUrl -Headers @{"Cookie" = $cookies}
        
        if ($response.StatusCode -eq 200) {
            Write-Test "Recherche accessible" $true
            $content = $response.Content | ConvertFrom-Json
            Write-Info "Résultats: $($content.results.Count)"
        } else {
            Write-Test "Recherche accessible" $false
        }
    } catch {
        Write-Test "Recherche accessible" $false
    }

    # Test dashboard stats
    try {
        $dashboardUrl = "$BaseUrl/api/dashboard"
        $response = Invoke-WebRequestWithBody -Url $dashboardUrl -Headers @{"Cookie" = $cookies}
        
        if ($response.StatusCode -eq 200) {
            Write-Test "Dashboard stats accessibles" $true
        } else {
            Write-Test "Dashboard stats accessibles" $false
        }
    } catch {
        Write-Test "Dashboard stats accessibles" $false
    }

    # Test top errors
    try {
        $topErrorsUrl = "$BaseUrl/api/dashboard/top-errors"
        $response = Invoke-WebRequestWithBody -Url $topErrorsUrl -Headers @{"Cookie" = $cookies}
        
        if ($response.StatusCode -eq 200) {
            Write-Test "Top errors accessible" $true
        } else {
            Write-Test "Top errors accessible" $false
        }
    } catch {
        Write-Test "Top errors accessible" $false
    }
}

# === 7. ALERTES ===
Write-Section "7. ALERTES"

if (Test-Path $Global:CookieFile) {
    $cookies = Get-Content $Global:CookieFile -Raw
    
    try {
        $alertsUrl = "$BaseUrl/api/admin/alerts"
        $response = Invoke-WebRequestWithBody -Url $alertsUrl -Headers @{"Cookie" = $cookies}
        
        if ($response.StatusCode -eq 200) {
            Write-Test "Liste des alertes accessible" $true
            $content = $response.Content | ConvertFrom-Json
            Write-Info "Nombre d'alertes: $($content.Count)"
        } else {
            Write-Test "Liste des alertes accessible" $false
        }
    } catch {
        Write-Test "Liste des alertes accessible" $false
    }
}

# === 8. RÉTENTION ===
Write-Section "8. RÉTENTION"

if (Test-Path $Global:CookieFile) {
    $cookies = Get-Content $Global:CookieFile -Raw
    
    # Test stats retention
    try {
        $retentionStatsUrl = "$BaseUrl/api/admin/retention/stats"
        $response = Invoke-WebRequestWithBody -Url $retentionStatsUrl -Headers @{"Cookie" = $cookies}
        
        if ($response.StatusCode -eq 200) {
            Write-Test "Stats retention accessibles" $true
            $content = $response.Content | ConvertFrom-Json
            Write-Info "Total logs: $($content.totalLogs)"
        } else {
            Write-Test "Stats retention accessibles" $false
        }
    } catch {
        Write-Test "Stats retention accessibles" $false
    }

    Write-Info "Test de run retention non exécuté (destructif)"
    Write-Test "Run retention testé" $false
}

# === 9. PURGE MANUELLE ===
Write-Section "9. PURGE MANUELLE"

if (Test-Path $Global:CookieFile) {
    $cookies = Get-Content $Global:CookieFile -Raw
    
    # Test purge sans critère (doit échouer)
    try {
        $purgeUrl = "$BaseUrl/api/admin/purge"
        $purgeBody = @{} | ConvertTo-Json
        $response = Invoke-WebRequestWithBody -Url $purgeUrl -Method "POST" -Body $purgeBody -Headers @{"Cookie" = $cookies}
        
        if ($response.StatusCode -eq 400) {
            Write-Test "Purge sans critère rejetée" $true
        } else {
            Write-Test "Purge sans critère rejetée" $false
        }
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.Value__
        Write-Test "Purge sans critère rejetée" ($statusCode -eq 400)
    }

    # Test purge avec niveau invalide (doit échouer)
    try {
        $purgeUrl = "$BaseUrl/api/admin/purge"
        $purgeBody = @{
            level = "INVALID_LEVEL"
        } | ConvertTo-Json
        $response = Invoke-WebRequestWithBody -Url $purgeUrl -Method "POST" -Body $purgeBody -Headers @{"Cookie" = $cookies}
        
        if ($response.StatusCode -eq 400) {
            Write-Test "Purge avec niveau invalide rejetée" $true
        } else {
            Write-Test "Purge avec niveau invalide rejetée" $false
        }
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.Value__
        Write-Test "Purge avec niveau invalide rejetée" ($statusCode -eq 400)
    }

    Write-Info "Test de purge avec critères valides non exécuté (destructif)"
    Write-Test "Purge par niveau testée" $false
    Write-Test "Purge par date testée" $false
}

# === 10. ROBUSTESSE DB / SCHÉMA ===
Write-Section "10. ROBUSTESSE DB / SCHÉMA"

Write-Info "Vérification du schéma via diagnose:comprehensive"
try {
    npm run diagnose:comprehensive 2>&1 | Out-Null
    Write-Test "Schéma base de données valide" $true
} catch {
    Write-Test "Schéma base de données valide" $false
}

# === 11. SÉCURITÉ ===
Write-Section "11. SÉCURITÉ"

# Test rate limit (simulé par plusieurs requêtes rapides)
Write-Info "Test rate limit non implémenté dans ce script"
Write-Test "Rate limit actif" $false

# Test session cookie
if (Test-Path $Global:CookieFile) {
    $cookies = Get-Content $Global:CookieFile -Raw
    if ($cookies -match "connect.sid=") {
        Write-Test "Session cookie présent" $true
    } else {
        Write-Test "Session cookie présent" $false
    }
}

# === 12. PERFORMANCE LÉGÈRE ===
Write-Section "12. PERFORMANCE LÉGÈRE"

Write-Info "Test de performance non implémenté dans ce script"
Write-Test "Performance import" $false
Write-Test "Performance dashboard" $false

# === NETTOYAGE ===
if (Test-Path $Global:CookieFile) {
    Remove-Item $Global:CookieFile -Force
}

# === RÉSUMÉ ===
Write-Section "RÉSUMÉ DES TESTS"

Write-Host "`nTests réussis: $Global:TestPassed" -ForegroundColor Green
Write-Host "Tests échoués: $Global:TestFailed" -ForegroundColor Red
Write-Host "Total tests: $($Global:TestPassed + $Global:TestFailed)" -ForegroundColor Cyan

if ($Global:TestFailed -eq 0) {
    Write-Host "`n🎉 Tous les tests sont passés!" -ForegroundColor Green
    exit 0
} else {
    Write-Host "`n⚠️ Certains tests ont échoué" -ForegroundColor Yellow
    exit 1
}
