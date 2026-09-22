# Test fonctionnel simple des améliorations
$ErrorActionPreference = "Stop"
$BaseUrl = "http://localhost:3001"
$SessionCookie = ""

Write-Host "Starting comprehensive functional tests..." -ForegroundColor Green
Write-Host ""

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
        try {
            $errorResponse = $_.ErrorDetails.Message | ConvertFrom-Json
            return @{
                StatusCode = $_.Exception.Response.StatusCode.value__
                Body = $errorResponse
                Headers = @{}
            }
        } catch {
            return @{
                StatusCode = 500
                Body = @{ error = $_.Exception.Message }
                Headers = @{}
            }
        }
    }
}

function Test-Authentication {
    Write-Host "Testing authentication..." -ForegroundColor Yellow
    
    $loginData = @{
        email = "admin@logsystem.com"
        password = "admin123"
    }
    
    $response = Invoke-ApiRequest -Method "POST" -Path "/api/auth/login" -Data $loginData
    
    Write-Host "Response status: $($response.StatusCode)" -ForegroundColor Cyan
    Write-Host "Response body: $($response.Body | ConvertTo-Json -Compress)" -ForegroundColor Cyan
    
    if ($response.StatusCode -eq 200) {
        $setCookie = $response.Headers["Set-Cookie"]
        Write-Host "Set-Cookie header: $setCookie" -ForegroundColor Cyan
        
        if ($setCookie) {
            # Use the full Set-Cookie header for session management
            $global:SessionCookie = $setCookie
            Write-Host "Session cookie set (length: $($global:SessionCookie.Length))" -ForegroundColor Cyan
            Write-Host "OK: Authentication successful" -ForegroundColor Green
            return $true
        } else {
            Write-Host "No Set-Cookie header found" -ForegroundColor Yellow
            # Continue anyway since the login was successful
            Write-Host "OK: Authentication successful (no cookie)" -ForegroundColor Green
            return $true
        }
    }
    
    Write-Host "FAIL: Authentication failed: $($response.StatusCode)" -ForegroundColor Red
    return $false
}

function Test-DashboardFilters {
    Write-Host ""
    Write-Host "Testing dashboard filters..." -ForegroundColor Yellow
    
    $tests = @(
        @{ Name = "Level filter"; Params = "?level=ERROR" },
        @{ Name = "Platform filter"; Params = "?platform=Production" },
        @{ Name = "Source type filter"; Params = "?sourceType=import" },
        @{ Name = "Directory filter"; Params = "?directory=/var/log" },
        @{ Name = "Service filter"; Params = "?service=auth" },
        @{ Name = "Time range filter"; Params = "?timeRange=24h" },
        @{ Name = "Combined filter"; Params = "?level=ERROR&platform=Production&timeRange=24h" }
    )
    
    $passed = 0
    foreach ($test in $tests) {
        $response = Invoke-ApiRequest -Method "GET" -Path "/api/dashboard/recent-logs$($test.Params)" -Cookie $global:SessionCookie
        
        if ($response.StatusCode -eq 200) {
            Write-Host "OK: $($test.Name): $($response.StatusCode)" -ForegroundColor Green
            $passed++
        } else {
            Write-Host "FAIL: $($test.Name): $($response.StatusCode)" -ForegroundColor Red
        }
    }
    
    Write-Host "Result: $passed/$($tests.Count) tests passed" -ForegroundColor Cyan
    return $passed -eq $tests.Count
}

function Test-SharingAPI {
    Write-Host ""
    Write-Host "Testing sharing API..." -ForegroundColor Yellow
    
    $logsResponse = Invoke-ApiRequest -Method "GET" -Path "/api/dashboard/recent-logs?limit=5" -Cookie $global:SessionCookie
    $logIds = @()
    if ($logsResponse.Body.recentLogs) {
        $logIds = $logsResponse.Body.recentLogs | ForEach-Object { $_.id }
    }
    if ($logIds.Count -eq 0) { $logIds = @(1, 2, 3) }
    
    $tests = @(
        @{ 
            Name = "Share config"
            Method = "GET"
            Path = "/api/share/config"
            Data = $null
        },
        @{ 
            Name = "Email share"
            Method = "POST"
            Path = "/api/share/email"
            Data = @{
                emailTo = "test@example.com"
                logIds = $logIds
                subject = "Test Export"
            }
        },
        @{ 
            Name = "WhatsApp share"
            Method = "POST"
            Path = "/api/share/whatsapp"
            Data = @{
                phoneNumber = "+33612345678"
                logIds = $logIds
                message = "Test Export"
            }
        },
        @{ 
            Name = "Shareable link"
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
            Write-Host "OK: $($test.Name): $($response.StatusCode)" -ForegroundColor Green
            $passed++
        } else {
            Write-Host "FAIL: $($test.Name): $($response.StatusCode)" -ForegroundColor Red
        }
    }
    
    Write-Host "Result: $passed/$($tests.Count) tests passed" -ForegroundColor Cyan
    return $passed -eq $tests.Count
}

function Test-AlertAutomation {
    Write-Host ""
    Write-Host "Testing alert automation..." -ForegroundColor Yellow
    
    $tests = @(
        @{ Name = "Get alerts"; Path = "/api/dashboard/alerts" },
        @{ Name = "Critical alerts"; Path = "/api/dashboard/alerts/critical-only" },
        @{ Name = "Grouped alerts"; Path = "/api/dashboard/alerts/grouped" },
        @{ Name = "System alerts"; Path = "/api/dashboard/alerts/system-only" }
    )
    
    $passed = 0
    foreach ($test in $tests) {
        $response = Invoke-ApiRequest -Method "GET" -Path $test.Path -Cookie $global:SessionCookie
        
        if ($response.StatusCode -eq 200) {
            Write-Host "OK: $($test.Name): $($response.StatusCode)" -ForegroundColor Green
            $passed++
        } else {
            Write-Host "FAIL: $($test.Name): $($response.StatusCode)" -ForegroundColor Red
        }
    }
    
    Write-Host "Result: $passed/$($tests.Count) tests passed" -ForegroundColor Cyan
    return $passed -eq $tests.Count
}

function Test-BugFixes {
    Write-Host ""
    Write-Host "Testing bug fixes..." -ForegroundColor Yellow
    
    $tests = @(
        @{ Name = "Search standard"; Path = "/api/search?query=error&limit=10" },
        @{ Name = "Search with level"; Path = "/api/search?query=error&level=ERROR&limit=10" },
        @{ Name = "Search metadata"; Path = "/api/search/metadata" },
        @{ Name = "Search trends"; Path = "/api/search/trends?window_hours=24" }
    )
    
    $passed = 0
    foreach ($test in $tests) {
        $response = Invoke-ApiRequest -Method "GET" -Path $test.Path -Cookie $global:SessionCookie
        
        if ($response.StatusCode -eq 200) {
            Write-Host "OK: $($test.Name): $($response.StatusCode)" -ForegroundColor Green
            $passed++
        } else {
            Write-Host "FAIL: $($test.Name): $($response.StatusCode)" -ForegroundColor Red
        }
    }
    
    Write-Host "Result: $passed/$($tests.Count) tests passed" -ForegroundColor Cyan
    return $passed -eq $tests.Count
}

function Test-DatabaseIntegrity {
    Write-Host ""
    Write-Host "Testing database integrity..." -ForegroundColor Yellow
    
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
            Write-Host "OK: $($test.Name): $($response.StatusCode)" -ForegroundColor Green
            $passed++
        } else {
            Write-Host "FAIL: $($test.Name): $($response.StatusCode)" -ForegroundColor Red
        }
    }
    
    Write-Host "Result: $passed/$($tests.Count) tests passed" -ForegroundColor Cyan
    return $passed -eq $tests.Count
}

function Run-AllTests {
    $authSuccess = Test-Authentication
    if (-not $authSuccess) {
        Write-Host "Cannot continue without authentication" -ForegroundColor Red
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
    Write-Host "FINAL TEST SUMMARY:" -ForegroundColor Magenta
    Write-Host "==================================================" -ForegroundColor Magenta
    
    foreach ($test in $results.Keys) {
        $status = if ($results[$test]) { "PASS" } else { "FAIL" }
        $color = if ($results[$test]) { "Green" } else { "Red" }
        Write-Host "$($test.PadRight(25)): $status" -ForegroundColor $color
    }
    
    $totalPassed = ($results.Values | Where-Object { $_ }).Count
    $totalTests = $results.Count
    
    Write-Host "==================================================" -ForegroundColor Magenta
    Write-Host "Final score: $totalPassed/$totalTests test categories passed" -ForegroundColor Cyan
    
    if ($totalPassed -eq $totalTests) {
        Write-Host "All functional tests passed successfully!" -ForegroundColor Green
    } else {
        Write-Host "Some tests failed. Check logs above." -ForegroundColor Yellow
    }
}

Run-AllTests