# LogSystem QA Test Script
$baseUrl = "https://logsystem-z41e.onrender.com"
$results = @{}

# Helper function for API calls
function Invoke-ApiCall {
    param(
        [string]$Method,
        [string]$Endpoint,
        [object]$Body,
        [Microsoft.PowerShell.Commands.WebRequestSession]$Session
    )
    
    $headers = @{"Content-Type" = "application/json"}
    $bodyJson = if ($Body) { $Body | ConvertTo-Json -Depth 10 } else { $null }
    
    try {
        if ($Session) {
            $response = Invoke-WebRequest -Uri "$baseUrl$Endpoint" -Method $Method -Headers $headers -Body $bodyJson -WebSession $Session -UseBasicParsing
        } else {
            $response = Invoke-WebRequest -Uri "$baseUrl$Endpoint" -Method $Method -Headers $headers -Body $bodyJson -UseBasicParsing
        }
        return @{
            success = $true
            statusCode = $response.StatusCode
            content = $response.Content
        }
    } catch {
        return @{
            success = $false
            statusCode = $_.Exception.Response.StatusCode.value__
            error = $_.Exception.Message
        }
    }
}

# Test 1: Admin Login
Write-Host "Test 1: Admin Login" -ForegroundColor Cyan
$adminSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$loginResult = Invoke-ApiCall -Method "POST" -Endpoint "/api/auth/login" -Body @{email="admin@logsystem.com"; password="Admin@2026!"} -Session $adminSession
if ($loginResult.success -and $loginResult.statusCode -eq 200) {
    $userData = $loginResult.content | ConvertFrom-Json
    if ($userData.role -eq "admin" -and $userData.display_name -eq "Administrateur") {
        $results["admin_login"] = "OK"
        Write-Host "✅ Admin login successful" -ForegroundColor Green
    } else {
        $results["admin_login"] = "KO"
        Write-Host "❌ Admin login failed - wrong user data" -ForegroundColor Red
    }
} else {
    $results["admin_login"] = "KO"
    Write-Host "❌ Admin login failed" -ForegroundColor Red
}

# Test 2: User Login
Write-Host "`nTest 2: User Login" -ForegroundColor Cyan
$userSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$loginResult = Invoke-ApiCall -Method "POST" -Endpoint "/api/auth/login" -Body @{email="user@logsystem.com"; password="User@2026!"} -Session $userSession
if ($loginResult.success -and $loginResult.statusCode -eq 200) {
    $userData = $loginResult.content | ConvertFrom-Json
    if ($userData.role -eq "user") {
        $results["user_login"] = "OK"
        Write-Host "✅ User login successful" -ForegroundColor Green
    } else {
        $results["user_login"] = "KO"
        Write-Host "❌ User login failed - wrong role" -ForegroundColor Red
    }
} else {
    $results["user_login"] = "KO"
    Write-Host "❌ User login failed" -ForegroundColor Red
}

# Test 3: Admin Dashboard Summary
Write-Host "`nTest 3: Admin Dashboard Summary" -ForegroundColor Cyan
$summaryResult = Invoke-ApiCall -Method "GET" -Endpoint "/api/dashboard/summary" -Session $adminSession
if ($summaryResult.success -and $summaryResult.statusCode -eq 200) {
    $summaryData = $summaryResult.content | ConvertFrom-Json
    if ($summaryData.total_logs -ge 0) {
        $results["admin_dashboard_summary"] = "OK"
        Write-Host "✅ Admin dashboard summary works - Total logs: $($summaryData.total_logs)" -ForegroundColor Green
    } else {
        $results["admin_dashboard_summary"] = "KO"
        Write-Host "❌ Admin dashboard summary failed" -ForegroundColor Red
    }
} else {
    $results["admin_dashboard_summary"] = "KO"
    Write-Host "❌ Admin dashboard summary failed" -ForegroundColor Red
}

# Test 4: User Dashboard Summary
Write-Host "`nTest 4: User Dashboard Summary" -ForegroundColor Cyan
$summaryResult = Invoke-ApiCall -Method "GET" -Endpoint "/api/dashboard/summary" -Session $userSession
if ($summaryResult.success -and $summaryResult.statusCode -eq 200) {
    $summaryData = $summaryResult.content | ConvertFrom-Json
    $results["user_dashboard_summary"] = "OK"
    Write-Host "✅ User dashboard summary works - Total logs: $($summaryData.total_logs)" -ForegroundColor Green
} else {
    $results["user_dashboard_summary"] = "KO"
    Write-Host "❌ User dashboard summary failed" -ForegroundColor Red
}

# Test 5: Admin Dashboard Trends
Write-Host "`nTest 5: Admin Dashboard Trends" -ForegroundColor Cyan
$trendsResult = Invoke-ApiCall -Method "GET" -Endpoint "/api/dashboard/trends" -Session $adminSession
if ($trendsResult.success -and $trendsResult.statusCode -eq 200) {
    $trendsData = $trendsResult.content | ConvertFrom-Json
    if ($trendsData.dates -and $trendsData.dates.Count -gt 0) {
        $results["admin_dashboard_trends"] = "OK"
        Write-Host "✅ Admin dashboard trends works - Days: $($trendsData.days)" -ForegroundColor Green
    } else {
        $results["admin_dashboard_trends"] = "KO"
        Write-Host "❌ Admin dashboard trends failed - no data" -ForegroundColor Red
    }
} else {
    $results["admin_dashboard_trends"] = "KO"
    Write-Host "❌ Admin dashboard trends failed" -ForegroundColor Red
}

# Test 6: Admin Recent Logs
Write-Host "`nTest 6: Admin Recent Logs" -ForegroundColor Cyan
$recentResult = Invoke-ApiCall -Method "GET" -Endpoint "/api/dashboard/recent-logs" -Session $adminSession
if ($recentResult.success -and $recentResult.statusCode -eq 200) {
    $results["admin_recent_logs"] = "OK"
    Write-Host "✅ Admin recent logs works" -ForegroundColor Green
} else {
    $results["admin_recent_logs"] = "KO"
    Write-Host "❌ Admin recent logs failed" -ForegroundColor Red
}

# Test 7: Admin Alerts
Write-Host "`nTest 7: Admin Alerts" -ForegroundColor Cyan
$alertsResult = Invoke-ApiCall -Method "GET" -Endpoint "/api/dashboard/alerts" -Session $adminSession
if ($alertsResult.success -and $alertsResult.statusCode -eq 200) {
    $results["admin_alerts"] = "OK"
    Write-Host "✅ Admin alerts works" -ForegroundColor Green
} else {
    $results["admin_alerts"] = "KO"
    Write-Host "❌ Admin alerts failed" -ForegroundColor Red
}

# Test 8: Admin System Status
Write-Host "`nTest 8: Admin System Status" -ForegroundColor Cyan
$systemResult = Invoke-ApiCall -Method "GET" -Endpoint "/api/dashboard/system" -Session $adminSession
if ($systemResult.success -and $systemResult.statusCode -eq 200) {
    $results["admin_system"] = "OK"
    Write-Host "✅ Admin system status works" -ForegroundColor Green
} else {
    $results["admin_system"] = "KO"
    Write-Host "❌ Admin system status failed" -ForegroundColor Red
}

# Test 9: Logs List
Write-Host "`nTest 9: Logs List" -ForegroundColor Cyan
$logsResult = Invoke-ApiCall -Method "GET" -Endpoint "/api/logs" -Session $adminSession
if ($logsResult.success -and $logsResult.statusCode -eq 200) {
    $results["logs_list"] = "OK"
    Write-Host "✅ Logs list works" -ForegroundColor Green
} else {
    $results["logs_list"] = "KO"
    Write-Host "❌ Logs list failed" -ForegroundColor Red
}

# Test 10: Admin Users List
Write-Host "`nTest 10: Admin Users List" -ForegroundColor Cyan
$usersResult = Invoke-ApiCall -Method "GET" -Endpoint "/api/admin/users" -Session $adminSession
if ($usersResult.success -and $usersResult.statusCode -eq 200) {
    $results["admin_users"] = "OK"
    Write-Host "✅ Admin users list works" -ForegroundColor Green
} else {
    $results["admin_users"] = "KO"
    Write-Host "❌ Admin users list failed" -ForegroundColor Red
}

# Test 11: User cannot access admin
Write-Host "`nTest 11: User cannot access admin endpoints" -ForegroundColor Cyan
$usersResult = Invoke-ApiCall -Method "GET" -Endpoint "/api/admin/users" -Session $userSession
if ($usersResult.success -eq $false -or ($usersResult.statusCode -ne 200)) {
    $results["user_admin_access"] = "OK"
    Write-Host "✅ User correctly blocked from admin endpoints" -ForegroundColor Green
} else {
    $results["user_admin_access"] = "KO"
    Write-Host "❌ User can access admin endpoints - SECURITY ISSUE" -ForegroundColor Red
}

# Test 12: Unauthenticated access blocked
Write-Host "`nTest 12: Unauthenticated access blocked" -ForegroundColor Cyan
$noSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$logsResult = Invoke-ApiCall -Method "GET" -Endpoint "/api/logs" -Session $noSession
if ($logsResult.success -eq $false -or $logsResult.statusCode -eq 401) {
    $results["unauth_blocked"] = "OK"
    Write-Host "✅ Unauthenticated access correctly blocked" -ForegroundColor Green
} else {
    $results["unauth_blocked"] = "KO"
    Write-Host "❌ Unauthenticated access not blocked - SECURITY ISSUE" -ForegroundColor Red
}

# Print summary
Write-Host "`n═══════════════════════════════════════" -ForegroundColor Cyan
Write-Host "TEST SUMMARY" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan

$okCount = ($results.Values | Where-Object { $_ -eq "OK" }).Count
$koCount = ($results.Values | Where-Object { $_ -eq "KO" }).Count

foreach ($key in $results.Keys) {
    $status = $results[$key]
    $color = if ($status -eq "OK") { "Green" } else { "Red" }
    Write-Host "$key : $status" -ForegroundColor $color
}

Write-Host "`nTotal: $okCount OK / $koCount KO" -ForegroundColor Cyan

$results | ConvertTo-Json | Out-File "qa-results.json"
Write-Host "`nResults saved to qa-results.json" -ForegroundColor Yellow
