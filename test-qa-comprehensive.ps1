# LogSystem Comprehensive QA Test Script
$baseUrl = "https://logsystem-z41e.onrender.com"
$results = @{}
$testDetails = @{}

# Helper function for API calls with better session handling
function Invoke-ApiCall {
    param(
        [string]$Method,
        [string]$Endpoint,
        [object]$Body,
        [Microsoft.PowerShell.Commands.WebRequestSession]$Session,
        [hashtable]$Headers = @{}
    )
    
    $defaultHeaders = @{"Content-Type" = "application/json"}
    $allHeaders = $defaultHeaders + $Headers
    
    $bodyJson = if ($Body) { $Body | ConvertTo-Json -Depth 10 } else { $null }
    
    try {
        if ($Session) {
            $response = Invoke-RestMethod -Uri "$baseUrl$Endpoint" -Method $Method -Headers $allHeaders -Body $bodyJson -WebSession $Session -ErrorAction Stop
            return @{
                success = $true
                statusCode = 200
                content = $response
            }
        } else {
            $response = Invoke-RestMethod -Uri "$baseUrl$Endpoint" -Method $Method -Headers $allHeaders -Body $bodyJson -ErrorAction Stop
            return @{
                success = $true
                statusCode = 200
                content = $response
            }
        }
    } catch {
        $statusCode = if ($_.Exception.Response) { $_.Exception.Response.StatusCode.value__ } else { 0 }
        return @{
            success = $false
            statusCode = $statusCode
            error = $_.Exception.Message
        }
    }
}

# Create sessions
$adminSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$userSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession

Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan
Write-Host "1. AUTHENTIFICATION" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan

# Test 1.1: Admin Login
Write-Host "`n1.1 Admin Login (admin@logsystem.com)" -ForegroundColor Yellow
$loginResult = Invoke-ApiCall -Method "POST" -Endpoint "/api/auth/login" -Body @{email="admin@logsystem.com"; password="Admin@2026!"} -Session $adminSession
if ($loginResult.success -and $loginResult.statusCode -eq 200) {
    if ($loginResult.content.role -eq "admin" -and $loginResult.content.display_name -eq "Administrateur") {
        $results["auth_admin_login"] = "OK"
        $testDetails["auth_admin_login"] = "Admin login successful, role: admin, display_name: Administrateur"
        Write-Host "✅ OK - Admin login successful, role: admin, display_name: Administrateur" -ForegroundColor Green
    } else {
        $results["auth_admin_login"] = "KO"
        $testDetails["auth_admin_login"] = "Admin login failed - wrong user data: $($loginResult.content | ConvertTo-Json)"
        Write-Host "❌ KO - Admin login failed - wrong user data" -ForegroundColor Red
    }
} else {
    $results["auth_admin_login"] = "KO"
    $testDetails["auth_admin_login"] = "Admin login failed with status $($loginResult.statusCode): $($loginResult.error)"
    Write-Host "❌ KO - Admin login failed with status $($loginResult.statusCode)" -ForegroundColor Red
}

# Test 1.2: User Login
Write-Host "`n1.2 User Login (user@logsystem.com)" -ForegroundColor Yellow
$loginResult = Invoke-ApiCall -Method "POST" -Endpoint "/api/auth/login" -Body @{email="user@logsystem.com"; password="User@2026!"} -Session $userSession
if ($loginResult.success -and $loginResult.statusCode -eq 200) {
    if ($loginResult.content.role -eq "user") {
        $results["auth_user_login"] = "OK"
        $testDetails["auth_user_login"] = "User login successful, role: user, display_name: $($loginResult.content.display_name)"
        Write-Host "✅ OK - User login successful, role: user, display_name: $($loginResult.content.display_name)" -ForegroundColor Green
    } else {
        $results["auth_user_login"] = "KO"
        $testDetails["auth_user_login"] = "User login failed - wrong role: $($loginResult.content.role)"
        Write-Host "❌ KO - User login failed - wrong role" -ForegroundColor Red
    }
} else {
    $results["auth_user_login"] = "KO"
    $testDetails["auth_user_login"] = "User login failed with status $($loginResult.statusCode)"
    Write-Host "❌ KO - User login failed with status $($loginResult.statusCode)" -ForegroundColor Red
}

# Test 1.3: Admin page without auth
Write-Host "`n1.3 Admin page without authentication" -ForegroundColor Yellow
$noAuthSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$adminPageResult = Invoke-WebRequest -Uri "$baseUrl/admin.html" -WebSession $noAuthSession -UseBasicParsing -ErrorAction SilentlyContinue
if ($adminPageResult.Content -match "login" -or $adminPageResult.StatusCode -eq 302) {
    $results["auth_admin_page_redirect"] = "OK"
    $testDetails["auth_admin_page_redirect"] = "Admin page correctly redirects to login when not authenticated"
    Write-Host "✅ OK - Admin page correctly redirects to login" -ForegroundColor Green
} else {
    $results["auth_admin_page_redirect"] = "KO"
    $testDetails["auth_admin_page_redirect"] = "Admin page does not redirect to login when not authenticated"
    Write-Host "❌ KO - Admin page does not redirect to login" -ForegroundColor Red
}

# Test 1.4: Dashboard page without auth
Write-Host "`n1.4 Dashboard page without authentication" -ForegroundColor Yellow
$noAuthSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$dashPageResult = Invoke-WebRequest -Uri "$baseUrl/dashboard.html" -WebSession $noAuthSession -UseBasicParsing -ErrorAction SilentlyContinue
if ($dashPageResult.Content -match "login" -or $dashPageResult.StatusCode -eq 302) {
    $results["auth_dashboard_page_redirect"] = "OK"
    $testDetails["auth_dashboard_page_redirect"] = "Dashboard page correctly redirects to login when not authenticated"
    Write-Host "✅ OK - Dashboard page correctly redirects to login" -ForegroundColor Green
} else {
    $results["auth_dashboard_page_redirect"] = "KO"
    $testDetails["auth_dashboard_page_redirect"] = "Dashboard page does not redirect to login when not authenticated"
    Write-Host "❌ KO - Dashboard page does not redirect to login" -ForegroundColor Red
}

Write-Host "`n═══════════════════════════════════════" -ForegroundColor Cyan
Write-Host "2. DASHBOARD (Admin)" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan

# Test 2.1: Admin Dashboard Summary
Write-Host "`n2.1 Admin Dashboard Summary" -ForegroundColor Yellow
$summaryResult = Invoke-ApiCall -Method "GET" -Endpoint "/api/dashboard/summary" -Session $adminSession
if ($summaryResult.success) {
    $data = $summaryResult.content
    if ($data.total_logs -ge 0 -and $data.today_logs -ge 0) {
        $results["dashboard_admin_summary"] = "OK"
        $testDetails["dashboard_admin_summary"] = "Summary works - Total: $($data.total_logs), Today: $($data.today_logs), Errors: $($data.error_count), Fatals: $($data.fatal_count)"
        Write-Host "✅ OK - Total: $($data.total_logs), Today: $($data.today_logs), Errors: $($data.error_count), Fatals: $($data.fatal_count)" -ForegroundColor Green
    } else {
        $results["dashboard_admin_summary"] = "KO"
        $testDetails["dashboard_admin_summary"] = "Summary returned invalid data"
        Write-Host "❌ KO - Summary returned invalid data" -ForegroundColor Red
    }
} else {
    $results["dashboard_admin_summary"] = "KO"
    $testDetails["dashboard_admin_summary"] = "Summary failed with status $($summaryResult.statusCode)"
    Write-Host "❌ KO - Summary failed with status $($summaryResult.statusCode)" -ForegroundColor Red
}

# Test 2.2: Admin Dashboard Trends
Write-Host "`n2.2 Admin Dashboard Trends" -ForegroundColor Yellow
$trendsResult = Invoke-ApiCall -Method "GET" -Endpoint "/api/dashboard/trends" -Session $adminSession
if ($trendsResult.success) {
    $data = $trendsResult.content
    if ($data.dates -and $data.dates.Count -gt 0) {
        $results["dashboard_admin_trends"] = "OK"
        $testDetails["dashboard_admin_trends"] = "Trends works - Days: $($data.days), Dates count: $($data.dates.Count)"
        Write-Host "✅ OK - Trends works - Days: $($data.days), Dates count: $($data.dates.Count)" -ForegroundColor Green
    } else {
        $results["dashboard_admin_trends"] = "KO"
        $testDetails["dashboard_admin_trends"] = "Trends returned no dates"
        Write-Host "❌ KO - Trends returned no dates" -ForegroundColor Red
    }
} else {
    $results["dashboard_admin_trends"] = "KO"
    $testDetails["dashboard_admin_trends"] = "Trends failed with status $($trendsResult.statusCode)"
    Write-Host "❌ KO - Trends failed with status $($trendsResult.statusCode)" -ForegroundColor Red
}

# Test 2.3: Admin Recent Logs
Write-Host "`n2.3 Admin Recent Logs" -ForegroundColor Yellow
$recentResult = Invoke-ApiCall -Method "GET" -Endpoint "/api/dashboard/recent-logs" -Session $adminSession
if ($recentResult.success) {
    $results["dashboard_admin_recent_logs"] = "OK"
    $testDetails["dashboard_admin_recent_logs"] = "Recent logs works - returned data"
    Write-Host "✅ OK - Recent logs works" -ForegroundColor Green
} else {
    $results["dashboard_admin_recent_logs"] = "KO"
    $testDetails["dashboard_admin_recent_logs"] = "Recent logs failed with status $($recentResult.statusCode): $($recentResult.error)"
    Write-Host "❌ KO - Recent logs failed with status $($recentResult.statusCode)" -ForegroundColor Red
}

# Test 2.4: Admin Alerts
Write-Host "`n2.4 Admin Alerts" -ForegroundColor Yellow
$alertsResult = Invoke-ApiCall -Method "GET" -Endpoint "/api/dashboard/alerts" -Session $adminSession
if ($alertsResult.success) {
    $results["dashboard_admin_alerts"] = "OK"
    $testDetails["dashboard_admin_alerts"] = "Alerts works - returned data"
    Write-Host "✅ OK - Alerts works" -ForegroundColor Green
} else {
    $results["dashboard_admin_alerts"] = "KO"
    $testDetails["dashboard_admin_alerts"] = "Alerts failed with status $($alertsResult.statusCode): $($alertsResult.error)"
    Write-Host "❌ KO - Alerts failed with status $($alertsResult.statusCode)" -ForegroundColor Red
}

# Test 2.5: Admin System Status
Write-Host "`n2.5 Admin System Status" -ForegroundColor Yellow
$systemResult = Invoke-ApiCall -Method "GET" -Endpoint "/api/dashboard/system" -Session $adminSession
if ($systemResult.success) {
    $results["dashboard_admin_system"] = "OK"
    $testDetails["dashboard_admin_system"] = "System status works - DB: $($systemResult.content.db), Redis: $($systemResult.content.redis)"
    Write-Host "✅ OK - System status works - DB: $($systemResult.content.db), Redis: $($systemResult.content.redis)" -ForegroundColor Green
} else {
    $results["dashboard_admin_system"] = "KO"
    $testDetails["dashboard_admin_system"] = "System status failed with status $($systemResult.statusCode)"
    Write-Host "❌ KO - System status failed with status $($systemResult.statusCode)" -ForegroundColor Red
}

Write-Host "`n═══════════════════════════════════════" -ForegroundColor Cyan
Write-Host "3. DASHBOARD (User)" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan

# Test 3.1: User Dashboard Summary
Write-Host "`n3.1 User Dashboard Summary" -ForegroundColor Yellow
$summaryResult = Invoke-ApiCall -Method "GET" -Endpoint "/api/dashboard/summary" -Session $userSession
if ($summaryResult.success) {
    $data = $summaryResult.content
    $results["dashboard_user_summary"] = "OK"
    $testDetails["dashboard_user_summary"] = "User summary works - Total: $($data.total_logs), Today: $($data.today_logs)"
    Write-Host "✅ OK - User summary works - Total: $($data.total_logs), Today: $($data.today_logs)" -ForegroundColor Green
} else {
    $results["dashboard_user_summary"] = "KO"
    $testDetails["dashboard_user_summary"] = "User summary failed with status $($summaryResult.statusCode)"
    Write-Host "❌ KO - User summary failed with status $($summaryResult.statusCode)" -ForegroundColor Red
}

Write-Host "`n═══════════════════════════════════════" -ForegroundColor Cyan
Write-Host "4. LOGS & SEARCH" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan

# Test 4.1: Logs List
Write-Host "`n4.1 Logs List" -ForegroundColor Yellow
$logsResult = Invoke-ApiCall -Method "GET" -Endpoint "/api/logs" -Session $adminSession
if ($logsResult.success) {
    $results["logs_list"] = "OK"
    $testDetails["logs_list"] = "Logs list works"
    Write-Host "✅ OK - Logs list works" -ForegroundColor Green
} else {
    $results["logs_list"] = "KO"
    $testDetails["logs_list"] = "Logs list failed with status $($logsResult.statusCode)"
    Write-Host "❌ KO - Logs list failed with status $($logsResult.statusCode)" -ForegroundColor Red
}

# Test 4.2: Logs with filter
Write-Host "`n4.2 Logs with level filter" -ForegroundColor Yellow
$logsFilterResult = Invoke-ApiCall -Method "GET" -Endpoint "/api/logs?level=ERROR" -Session $adminSession
if ($logsFilterResult.success) {
    $results["logs_filter_level"] = "OK"
    $testDetails["logs_filter_level"] = "Logs level filter works"
    Write-Host "✅ OK - Logs level filter works" -ForegroundColor Green
} else {
    $results["logs_filter_level"] = "KO"
    $testDetails["logs_filter_level"] = "Logs level filter failed with status $($logsFilterResult.statusCode)"
    Write-Host "❌ KO - Logs level filter failed with status $($logsFilterResult.statusCode)" -ForegroundColor Red
}

Write-Host "`n═══════════════════════════════════════" -ForegroundColor Cyan
Write-Host "5. ADMINISTRATION" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan

# Test 5.1: Admin Users List
Write-Host "`n5.1 Admin Users List" -ForegroundColor Yellow
$usersResult = Invoke-ApiCall -Method "GET" -Endpoint "/api/admin/users" -Session $adminSession
if ($usersResult.success) {
    $results["admin_users_list"] = "OK"
    $testDetails["admin_users_list"] = "Admin users list works"
    Write-Host "✅ OK - Admin users list works" -ForegroundColor Green
} else {
    $results["admin_users_list"] = "KO"
    $testDetails["admin_users_list"] = "Admin users list failed with status $($usersResult.statusCode)"
    Write-Host "❌ KO - Admin users list failed with status $($usersResult.statusCode)" -ForegroundColor Red
}

# Test 5.2: User cannot access admin
Write-Host "`n5.2 User cannot access admin endpoints" -ForegroundColor Yellow
$usersResult = Invoke-ApiCall -Method "GET" -Endpoint "/api/admin/users" -Session $userSession
if ($usersResult.success -eq $false -or $usersResult.statusCode -ne 200) {
    $results["admin_user_access_blocked"] = "OK"
    $testDetails["admin_user_access_blocked"] = "User correctly blocked from admin endpoints (status: $($usersResult.statusCode))"
    Write-Host "✅ OK - User correctly blocked from admin endpoints (status: $($usersResult.statusCode))" -ForegroundColor Green
} else {
    $results["admin_user_access_blocked"] = "KO"
    $testDetails["admin_user_access_blocked"] = "SECURITY ISSUE: User can access admin endpoints"
    Write-Host "❌ KO - SECURITY ISSUE: User can access admin endpoints" -ForegroundColor Red
}

Write-Host "`n═══════════════════════════════════════" -ForegroundColor Cyan
Write-Host "6. DATA ISOLATION" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan

# Test 6.1: Compare admin and user data
Write-Host "`n6.1 Data isolation between admin and user" -ForegroundColor Yellow
$adminSummary = Invoke-ApiCall -Method "GET" -Endpoint "/api/dashboard/summary" -Session $adminSession
$userSummary = Invoke-ApiCall -Method "GET" -Endpoint "/api/dashboard/summary" -Session $userSession
if ($adminSummary.success -and $userSummary.success) {
    if ($adminSummary.content.total_logs -ne $userSummary.content.total_logs) {
        $results["data_isolation"] = "OK"
        $testDetails["data_isolation"] = "Data isolation works - Admin has $($adminSummary.content.total_logs) logs, User has $($userSummary.content.total_logs) logs"
        Write-Host "✅ OK - Data isolation works - Admin has $($adminSummary.content.total_logs) logs, User has $($userSummary.content.total_logs) logs" -ForegroundColor Green
    } else {
        $results["data_isolation"] = "PARTIAL"
        $testDetails["data_isolation"] = "Data isolation may not be working - both have same number of logs: $($adminSummary.content.total_logs)"
        Write-Host "⚠️ PARTIAL - Data isolation may not be working - both have same number of logs: $($adminSummary.content.total_logs)" -ForegroundColor Yellow
    }
} else {
    $results["data_isolation"] = "KO"
    $testDetails["data_isolation"] = "Could not compare data - one or both requests failed"
    Write-Host "❌ KO - Could not compare data" -ForegroundColor Red
}

Write-Host "`n═══════════════════════════════════════" -ForegroundColor Cyan
Write-Host "7. SECURITY" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan

# Test 7.1: Unauthenticated access blocked
Write-Host "`n7.1 Unauthenticated access blocked" -ForegroundColor Yellow
$noSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$logsResult = Invoke-ApiCall -Method "GET" -Endpoint "/api/logs" -Session $noSession
if ($logsResult.success -eq $false -or $logsResult.statusCode -eq 401) {
    $results["security_unauth_blocked"] = "OK"
    $testDetails["security_unauth_blocked"] = "Unauthenticated access correctly blocked (status: $($logsResult.statusCode))"
    Write-Host "✅ OK - Unauthenticated access correctly blocked (status: $($logsResult.statusCode))" -ForegroundColor Green
} else {
    $results["security_unauth_blocked"] = "KO"
    $testDetails["security_unauth_blocked"] = "SECURITY ISSUE: Unauthenticated access not blocked"
    Write-Host "❌ KO - SECURITY ISSUE: Unauthenticated access not blocked" -ForegroundColor Red
}

# Print summary
Write-Host "`n═══════════════════════════════════════" -ForegroundColor Cyan
Write-Host "TEST SUMMARY" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan

$okCount = ($results.Values | Where-Object { $_ -eq "OK" }).Count
$koCount = ($results.Values | Where-Object { $_ -eq "KO" }).Count
$partialCount = ($results.Values | Where-Object { $_ -eq "PARTIAL" }).Count

foreach ($key in $results.Keys | Sort-Object) {
    $status = $results[$key]
    $color = if ($status -eq "OK") { "Green" } elseif ($status -eq "PARTIAL") { "Yellow" } else { "Red" }
    Write-Host "$key : $status" -ForegroundColor $color
}

Write-Host "`n═══════════════════════════════════════" -ForegroundColor Cyan
Write-Host "TOTAL: $okCount OK / $koCount KO / $partialCount PARTIAL" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan

# Save results
$output = @{
    summary = @{
        ok = $okCount
        ko = $koCount
        partial = $partialCount
    }
    results = $results
    details = $testDetails
}
$output | ConvertTo-Json -Depth 10 | Out-File "qa-results-detailed.json"
Write-Host "`nDetailed results saved to qa-results-detailed.json" -ForegroundColor Yellow
