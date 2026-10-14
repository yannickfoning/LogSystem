# Test Fonctionnel Complet - LogSystem Platform
# Ce script teste toutes les fonctionnalités principales de la plateforme

$ErrorActionPreference = "Stop"
$BaseUrl = "http://localhost:10000"
$TestResults = @()

function Write-TestResult {
    param(
        [string]$TestName,
        [bool]$Passed,
        [string]$Details = ""
    )
    
    $Status = if ($Passed) { "✅ PASS" } else { "❌ FAIL" }
    $Timestamp = Get-Date -Format "HH:mm:ss"
    
    Write-Host "[$Timestamp] $Status - $TestName" -NoNewline
    if ($Details) {
        Write-Host " : $Details"
    } else {
        Write-Host ""
    }
    
    $TestResults += @{
        TestName = $TestName
        Passed = $Passed
        Details = $Details
        Timestamp = $Timestamp
    }
}

function Test-HealthEndpoint {
    try {
        $Response = Invoke-WebRequest -Uri "$BaseUrl/health" -UseBasicParsing -TimeoutSec 10
        $Content = $Response.Content | ConvertFrom-Json
        
        if ($Response.StatusCode -eq 200 -and $Content.status -eq "ok" -and $Content.database -eq "ok") {
            Write-TestResult "Health Endpoint" $true "Status: $($Content.status), DB: $($Content.database), Uptime: $([math]::Round($Content.uptime, 2))s"
            return $true
        } else {
            Write-TestResult "Health Endpoint" $false "Status: $($Response.StatusCode)"
            return $false
        }
    } catch {
        Write-TestResult "Health Endpoint" $false "Error: $($_.Exception.Message)"
        return $false
    }
}

function Test-LoginPage {
    try {
        $Response = Invoke-WebRequest -Uri "$BaseUrl/login.html" -UseBasicParsing -TimeoutSec 10
        if ($Response.StatusCode -eq 200) {
            Write-TestResult "Login Page Access" $true "HTTP $($Response.StatusCode)"
            return $true
        } else {
            Write-TestResult "Login Page Access" $false "HTTP $($Response.StatusCode)"
            return $false
        }
    } catch {
        Write-TestResult "Login Page Access" $false "Error: $($_.Exception.Message)"
        return $false
    }
}

function Test-Authentication {
    try {
        $LoginBody = @{
            email = "admin@logsystem.local"
            password = "Admin@1234"
        } | ConvertTo-Json
        
        $Response = Invoke-WebRequest -Uri "$BaseUrl/api/auth/login" -Method POST -Body $LoginBody -ContentType "application/json" -UseBasicParsing -SessionVariable Session -TimeoutSec 10
        
        if ($Response.StatusCode -eq 200) {
            $Content = $Response.Content | ConvertFrom-Json
            Write-TestResult "Authentication" $true "User: $($Content.user.email), Role: $($Content.user.role)"
            return $Session
        } else {
            Write-TestResult "Authentication" $false "HTTP $($Response.StatusCode)"
            return $null
        }
    } catch {
        Write-TestResult "Authentication" $false "Error: $($_.Exception.Message)"
        return $null
    }
}

function Test-Dashboard {
    param($Session)
    
    try {
        $Response = Invoke-WebRequest -Uri "$BaseUrl/api/dashboard" -WebSession $Session -UseBasicParsing -TimeoutSec 10
        
        if ($Response.StatusCode -eq 200) {
            $Content = $Response.Content | ConvertFrom-Json
            Write-TestResult "Dashboard API" $true "TotalLogs: $($Content.totalLogs), TodayLogs: $($Content.todayLogs), ErrorCount: $($Content.errorCount)"
            return $true
        } else {
            Write-TestResult "Dashboard API" $false "HTTP $($Response.StatusCode)"
            return $false
        }
    } catch {
        Write-TestResult "Dashboard API" $false "Error: $($_.Exception.Message)"
        return $false
    }
}

function Test-SearchLogs {
    param($Session)
    
    try {
        $SearchParams = @{
            limit = 10
            offset = 0
        } | ConvertTo-Json
        
        $Response = Invoke-WebRequest -Uri "$BaseUrl/api/search" -Method POST -Body $SearchParams -ContentType "application/json" -WebSession $Session -UseBasicParsing -TimeoutSec 10
        
        if ($Response.StatusCode -eq 200) {
            $Content = $Response.Content | ConvertFrom-Json
            Write-TestResult "Search Logs API" $true "Found: $($Content.logs.Count) logs, Total: $($Content.total)"
            return $true
        } else {
            Write-TestResult "Search Logs API" $false "HTTP $($Response.StatusCode)"
            return $false
        }
    } catch {
        Write-TestResult "Search Logs API" $false "Error: $($_.Exception.Message)"
        return $false
    }
}

function Test-Alerts {
    param($Session)
    
    try {
        $Response = Invoke-WebRequest -Uri "$BaseUrl/api/alerts" -WebSession $Session -UseBasicParsing -TimeoutSec 10
        
        if ($Response.StatusCode -eq 200) {
            $Content = $Response.Content | ConvertFrom-Json
            Write-TestResult "Alerts API" $true "Alerts: $($Content.alerts.Count)"
            return $true
        } else {
            Write-TestResult "Alerts API" $false "HTTP $($Response.StatusCode)"
            return $false
        }
    } catch {
        Write-TestResult "Alerts API" $false "Error: $($_.Exception.Message)"
        return $false
    }
}

function Test-ImportCapabilities {
    try {
        $Response = Invoke-WebRequest -Uri "$BaseUrl/import.html" -UseBasicParsing -TimeoutSec 10
        
        if ($Response.StatusCode -eq 200) {
            Write-TestResult "Import Page Access" $true "HTTP $($Response.StatusCode)"
            return $true
        } else {
            Write-TestResult "Import Page Access" $false "HTTP $($Response.StatusCode)"
            return $false
        }
    } catch {
        Write-TestResult "Import Page Access" $false "Error: $($_.Exception.Message)"
        return $false
    }
}

function Test-DockerServices {
    Write-Host "`n=== Vérification des Services Docker ===" -ForegroundColor Cyan
    
    try {
        $DockerPs = docker ps --filter "name=logsystem" --format "{{.Names}}|{{.Status}}|{{.Ports}}"
        
        if ($DockerPs) {
            $Services = $DockerPs -split "`n"
            foreach ($Service in $Services) {
                $Parts = $Service -split "\|"
                $Name = $Parts[0]
                $Status = $Parts[1]
                $Ports = $Parts[2]
                
                if ($Status -like "*healthy*") {
                    Write-TestResult "Docker Service: $Name" $true "Status: $Status, Ports: $Ports"
                } else {
                    Write-TestResult "Docker Service: $Name" $false "Status: $Status"
                }
            }
            return $true
        } else {
            Write-TestResult "Docker Services" $false "No services found"
            return $false
        }
    } catch {
        Write-TestResult "Docker Services" $false "Error: $($_.Exception.Message)"
        return $false
    }
}

function Test-DatabaseConnection {
    Write-Host "`n=== Vérification de la Base de Données ===" -ForegroundColor Cyan
    
    try {
        $Result = docker exec logsystem-mysql mysql -u root -plocaldev123 logsystem -e "SELECT COUNT(*) as count FROM logs;" 2>&1
        $Count = ($Result | Select-String "^\d+$").Matches.Value
        
        if ($Count) {
            Write-TestResult "Database Connection" $true "Logs in database: $Count"
            return $true
        } else {
            Write-TestResult "Database Connection" $false "Could not retrieve log count"
            return $false
        }
    } catch {
        Write-TestResult "Database Connection" $false "Error: $($_.Exception.Message)"
        return $false
    }
}

function Test-PerformanceLimits {
    Write-Host "`n=== Vérification des Limites de Performance ===" -ForegroundColor Cyan
    
    try {
        $Config = docker exec logsystem printenv | Select-String -Pattern "UPLOAD_MAX_SIZE|IMPORT_BATCH_SIZE|MAX_EXTRACTED_FILES"
        
        if ($Config) {
            $MaxSize = ($Config | Select-String "UPLOAD_MAX_SIZE").ToString().Split("=")[1]
            $BatchSize = ($Config | Select-String "IMPORT_BATCH_SIZE").ToString().Split("=")[1]
            $MaxFiles = ($Config | Select-String "MAX_EXTRACTED_FILES").ToString().Split("=")[1]
            
            $MaxSizeMB = [math]::Round($MaxSize / 1MB, 2)
            
            Write-TestResult "Performance Limits" $true "MaxSize: ${MaxSizeMB}MB, BatchSize: $BatchSize, MaxFiles: $MaxFiles"
            return $true
        } else {
            Write-TestResult "Performance Limits" $false "Config not found"
            return $false
        }
    } catch {
        Write-TestResult "Performance Limits" $false "Error: $($_.Exception.Message)"
        return $false
    }
}

function Test-FileTypeSupport {
    Write-Host "`n=== Vérification du Support des Types de Fichiers ===" -ForegroundColor Cyan
    
    $SupportedFormats = @("log", "txt", "json", "jsonl", "csv", "xml", "zip", "gz", "tar", "rar", "7z")
    
    try {
        $TestFile = "test-$((Get-Date).ToString('yyyyMMddHHmmss')).log"
        $TestContent = "2026-09-30 12:00:00 INFO Test log entry for file type support"
        
        # Créer un fichier de test
        $TestContent | Out-File -FilePath "logs\$TestFile" -Encoding UTF8
        
        # Attendre que le watcher le traite
        Start-Sleep -Seconds 3
        
        # Vérifier si le fichier a été importé
        $Result = docker exec logsystem-mysql mysql -u root -plocaldev123 logsystem -e "SELECT COUNT(*) as count FROM logs WHERE message LIKE '%Test log entry for file type support%';" 2>&1
        $Count = ($Result | Select-String "^\d+$").Matches.Value
        
        if ($Count -gt 0) {
            Write-TestResult "File Type Support (.log)" $true "File imported successfully"
            
            # Nettoyer
            Remove-Item "logs\$TestFile" -ErrorAction SilentlyContinue
            return $true
        } else {
            Write-TestResult "File Type Support (.log)" $false "File not imported"
            Remove-Item "logs\$TestFile" -ErrorAction SilentlyContinue
            return $false
        }
    } catch {
        Write-TestResult "File Type Support (.log)" $false "Error: $($_.Exception.Message)"
        Remove-Item "logs\$TestFile" -ErrorAction SilentlyContinue
        return $false
    }
}

function Test-AlertEngine {
    Write-Host "`n=== Vérification du Moteur d'Alertes ===" -ForegroundColor Cyan
    
    try {
        $Logs = docker logs logsystem 2>&1 | Select-String -Pattern "alert_evaluation_completed" | Select-Object -Last 5
        
        if ($Logs) {
            $LastLog = $Logs[-1].ToString()
            if ($LastLog -match "rulesCount.*alertsCreated") {
                Write-TestResult "Alert Engine" $true "Engine running and evaluating rules"
                return $true
            } else {
                Write-TestResult "Alert Engine" $false "Unexpected log format"
                return $false
            }
        } else {
            Write-TestResult "Alert Engine" $false "No alert evaluation logs found"
            return $false
        }
    } catch {
        Write-TestResult "Alert Engine" $false "Error: $($_.Exception.Message)"
        return $false
    }
}

function Test-RedisConnection {
    Write-Host "`n=== Vérification de la Connexion Redis ===" -ForegroundColor Cyan
    
    try {
        $Result = docker exec logsystem-redis redis-cli -a localdev123 ping 2>&1
        
        if ($Result -match "PONG") {
            Write-TestResult "Redis Connection" $true "Redis responding correctly"
            return $true
        } else {
            Write-TestResult "Redis Connection" $false "Unexpected response: $Result"
            return $false
        }
    } catch {
        Write-TestResult "Redis Connection" $false "Error: $($_.Exception.Message)"
        return $false
    }
}

# ==================== MAIN TEST EXECUTION ====================

Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  TEST FONCTIONNEL COMPLET - LOGSYSTEM PLATFORM" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "Base URL: $BaseUrl" -ForegroundColor Yellow
Write-Host "Heure de début: $(Get-Date -Format 'HH:mm:ss')" -ForegroundColor Yellow
Write-Host ""

# Phase 1: Infrastructure
Write-Host "PHASE 1: INFRASTRUCTURE" -ForegroundColor Green
Test-DockerServices
Test-DatabaseConnection
Test-RedisConnection

# Phase 2: Configuration
Write-Host "`nPHASE 2: CONFIGURATION" -ForegroundColor Green
Test-PerformanceLimits

# Phase 3: Application Access
Write-Host "`nPHASE 3: ACCÈS APPLICATION" -ForegroundColor Green
Test-HealthEndpoint
Test-LoginPage

# Phase 4: Authentication & API
Write-Host "`nPHASE 4: AUTHENTIFICATION & API" -ForegroundColor Green
$Session = Test-Authentication
if ($Session) {
    Test-Dashboard -Session $Session
    Test-SearchLogs -Session $Session
    Test-Alerts -Session $Session
} else {
    Write-TestResult "API Tests" $false "Skipped due to authentication failure"
}

# Phase 5: Import & File Processing
Write-Host "`nPHASE 5: IMPORT & TRAITEMENT FICHIERS" -ForegroundColor Green
Test-ImportCapabilities
Test-FileTypeSupport

# Phase 6: Background Services
Write-Host "`nPHASE 6: SERVICES D'ARRIÈRE-PLAN" -ForegroundColor Green
Test-AlertEngine

# ==================== RESULTS SUMMARY ====================

Write-Host "`n═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  RÉSUMÉ DES RÉSULTATS" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan

$PassedCount = ($TestResults | Where-Object { $_.Passed -eq $true }).Count
$TotalCount = $TestResults.Count
$SuccessRate = [math]::Round(($PassedCount / $TotalCount) * 100, 1)

Write-Host ""
Write-Host "Tests passés: $PassedCount / $TotalCount ($SuccessRate%)" -ForegroundColor $(if ($SuccessRate -ge 80) { "Green" } elseif ($SuccessRate -ge 50) { "Yellow" } else { "Red" })
Write-Host "Heure de fin: $(Get-Date -Format 'HH:mm:ss')" -ForegroundColor Yellow

if ($SuccessRate -ge 80) {
    Write-Host "`n🎉 PLATEFORME FONCTIONNELLE - Tests réussis !" -ForegroundColor Green
} elseif ($SuccessRate -ge 50) {
    Write-Host "`n⚠️  PLATEFORME PARTIELLEMENT FONCTIONNELLE - Quelques problèmes détectés" -ForegroundColor Yellow
} else {
    Write-Host "`n❌ PLATEFORME NON FONCTIONNELLE - Problèmes critiques détectés" -ForegroundColor Red
}

Write-Host "`nDétails des tests échoués:" -ForegroundColor Yellow
$FailedTests = $TestResults | Where-Object { $_.Passed -eq $false }
if ($FailedTests) {
    foreach ($Test in $FailedTests) {
        Write-Host "  ❌ $($Test.TestName): $($Test.Details)" -ForegroundColor Red
    }
} else {
    Write-Host "  Aucun test échoué ! 🎉" -ForegroundColor Green
}

Write-Host "`n═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
