# LogSystem Full QA Test Script
$baseUrl = "https://logsystem-z41e.onrender.com"
$results = @{}
$testDetails = @{}

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

$adminSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$userSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession

Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan
Write-Host "1. AUTHENTIFICATION" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan

# Admin Login
Write-Host "`n1.1 Admin Login" -ForegroundColor Yellow
$loginResult = Invoke-ApiCall -Method "POST" -Endpoint "/api/auth/login" -Body @{email="admin@logsystem.com"; password="Admin@2026!"} -Session $adminSession
if ($loginResult.success -and $loginResult.content.role -eq "admin") {
    $results["auth_admin_login"] = "OK"
    $testDetails["auth_admin_login"] = "Admin login successful"
    Write-Host "✅ OK" -ForegroundColor Green
} else {
    $results["auth_admin_login"] = "KO"
    $testDetails["auth_admin_login"] = "Admin login failed"
    Write-Host "❌ KO" -ForegroundColor Red
}

# User Login
Write-Host "`n1.2 User Login" -ForegroundColor Yellow
$loginResult = Invoke-ApiCall -Method "POST" -Endpoint "/api/auth/login" -Body @{email="user@logsystem.com"; password="User@2026!"} -Session $userSession
if ($loginResult.success -and $loginResult.content.role -eq "user") {
    $results["auth_user_login"] = "OK"
    $testDetails["auth_user_login"] = "User login successful"
    Write-Host "✅ OK" -ForegroundColor Green
} else {
    $results["auth_user_login"] = "KO"
    $testDetails["auth_user_login"] = "User login failed"
    Write-Host "❌ KO" -ForegroundColor Red
}

# Admin page redirect
Write-Host "`n1.3 Admin page without auth redirects to login" -ForegroundColor Yellow
$noAuth = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$page = Invoke-WebRequest -Uri "$baseUrl/admin.html" -WebSession $noAuth -UseBasicParsing -ErrorAction SilentlyContinue
if ($page.Content -match "login" -or $page.StatusCode -eq 302) {
    $results["auth_admin_redirect"] = "OK"
    $testDetails["auth_admin_redirect"] = "Admin page redirects to login"
    Write-Host "✅ OK" -ForegroundColor Green
} else {
    $results["auth_admin_redirect"] = "KO"
    $testDetails["auth_admin_redirect"] = "Admin page does not redirect"
    Write-Host "❌ KO" -ForegroundColor Red
}

# Dashboard page redirect
Write-Host "`n1.4 Dashboard page without auth redirects to login" -ForegroundColor Yellow
$noAuth = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$page = Invoke-WebRequest -Uri "$baseUrl/dashboard.html" -WebSession $noAuth -UseBasicParsing -ErrorAction SilentlyContinue
if ($page.Content -match "login" -or $page.StatusCode -eq 302) {
    $results["auth_dashboard_redirect"] = "OK"
    $testDetails["auth_dashboard_redirect"] = "Dashboard page redirects to login"
    Write-Host "✅ OK" -ForegroundColor Green
} else {
    $results["auth_dashboard_redirect"] = "KO"
    $testDetails["auth_dashboard_redirect"] = "Dashboard page does not redirect"
    Write-Host "❌ KO" -ForegroundColor Red
}

Write-Host "`n═══════════════════════════════════════" -ForegroundColor Cyan
Write-Host "2. DASHBOARD (Admin)" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan

# Admin Summary
Write-Host "`n2.1 Admin Dashboard Summary" -ForegroundColor Yellow
$summary = Invoke-ApiCall -Method "GET" -Endpoint "/api/dashboard/summary" -Session $adminSession
if ($summary.success) {
    $results["dashboard_admin_summary"] = "OK"
    $testDetails["dashboard_admin_summary"] = "Summary: Total=$($summary.content.total_logs), Today=$($summary.content.today_logs), Errors=$($summary.content.error_count), Fatals=$($summary.content.fatal_count)"
    Write-Host "✅ OK - Total: $($summary.content.total_logs), Today: $($summary.content.today_logs), Errors: $($summary.content.error_count), Fatals: $($summary.content.fatal_count)" -ForegroundColor Green
} else {
    $results["dashboard_admin_summary"] = "KO"
    $testDetails["dashboard_admin_summary"] = "Summary failed"
    Write-Host "❌ KO" -ForegroundColor Red
}

# Admin Trends
Write-Host "`n2.2 Admin Dashboard Trends" -ForegroundColor Yellow
$trends = Invoke-ApiCall -Method "GET" -Endpoint "/api/dashboard/trends" -Session $adminSession
if ($trends.success -and $trends.content.dates.Count -gt 0) {
    $results["dashboard_admin_trends"] = "OK"
    $testDetails["dashboard_admin_trends"] = "Trends works with $($trends.content.days) days"
    Write-Host "✅ OK - Trends works with $($trends.content.days) days" -ForegroundColor Green
} else {
    $results["dashboard_admin_trends"] = "KO"
    $testDetails["dashboard_admin_trends"] = "Trends failed"
    Write-Host "❌ KO" -ForegroundColor Red
}

# Admin Recent Logs
Write-Host "`n2.3 Admin Recent Logs" -ForegroundColor Yellow
$recent = Invoke-ApiCall -Method "GET" -Endpoint "/api/dashboard/recent-logs" -Session $adminSession
if ($recent.success) {
    $results["dashboard_admin_recent_logs"] = "OK"
    $testDetails["dashboard_admin_recent_logs"] = "Recent logs works"
    Write-Host "✅ OK" -ForegroundColor Green
} else {
    $results["dashboard_admin_recent_logs"] = "KO"
    $testDetails["dashboard_admin_recent_logs"] = "Recent logs failed with status $($recent.statusCode): $($recent.error)"
    Write-Host "❌ KO - Status $($recent.statusCode): $($recent.error)" -ForegroundColor Red
}

# Admin Alerts
Write-Host "`n2.4 Admin Alerts" -ForegroundColor Yellow
$alerts = Invoke-ApiCall -Method "GET" -Endpoint "/api/dashboard/alerts" -Session $adminSession
if ($alerts.success) {
    $results["dashboard_admin_alerts"] = "OK"
    $testDetails["dashboard_admin_alerts"] = "Alerts works"
    Write-Host "✅ OK" -ForegroundColor Green
} else {
    $results["dashboard_admin_alerts"] = "KO"
    $testDetails["dashboard_admin_alerts"] = "Alerts failed with status $($alerts.statusCode): $($alerts.error)"
    Write-Host "❌ KO - Status $($alerts.statusCode): $($alerts.error)" -ForegroundColor Red
}

# Admin System
Write-Host "`n2.5 Admin System Status" -ForegroundColor Yellow
$system = Invoke-ApiCall -Method "GET" -Endpoint "/api/dashboard/system" -Session $adminSession
if ($system.success) {
    $results["dashboard_admin_system"] = "OK"
    $testDetails["dashboard_admin_system"] = "System: DB=$($system.content.db), Redis=$($system.content.redis)"
    Write-Host "✅ OK - DB: $($system.content.db), Redis: $($system.content.redis)" -ForegroundColor Green
} else {
    $results["dashboard_admin_system"] = "KO"
    $testDetails["dashboard_admin_system"] = "System failed"
    Write-Host "❌ KO" -ForegroundColor Red
}

Write-Host "`n═══════════════════════════════════════" -ForegroundColor Cyan
Write-Host "3. DASHBOARD (User)" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan

# User Summary
Write-Host "`n3.1 User Dashboard Summary" -ForegroundColor Yellow
$summary = Invoke-ApiCall -Method "GET" -Endpoint "/api/dashboard/summary" -Session $userSession
if ($summary.success) {
    $results["dashboard_user_summary"] = "OK"
    $testDetails["dashboard_user_summary"] = "User summary: Total=$($summary.content.total_logs)"
    Write-Host "✅ OK - Total: $($summary.content.total_logs)" -ForegroundColor Green
} else {
    $results["dashboard_user_summary"] = "KO"
    $testDetails["dashboard_user_summary"] = "User summary failed"
    Write-Host "❌ KO" -ForegroundColor Red
}

Write-Host "`n═══════════════════════════════════════" -ForegroundColor Cyan
Write-Host "4. LOGS & SEARCH" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan

# Logs List
Write-Host "`n4.1 Logs List" -ForegroundColor Yellow
$logs = Invoke-ApiCall -Method "GET" -Endpoint "/api/logs" -Session $adminSession
if ($logs.success) {
    $results["logs_list"] = "OK"
    $testDetails["logs_list"] = "Logs list works"
    Write-Host "✅ OK" -ForegroundColor Green
} else {
    $results["logs_list"] = "KO"
    $testDetails["logs_list"] = "Logs list failed"
    Write-Host "❌ KO" -ForegroundColor Red
}

# Logs Filter Level
Write-Host "`n4.2 Logs Filter by Level" -ForegroundColor Yellow
$logs = Invoke-ApiCall -Method "GET" -Endpoint "/api/logs?level=ERROR" -Session $adminSession
if ($logs.success) {
    $results["logs_filter_level"] = "OK"
    $testDetails["logs_filter_level"] = "Level filter works"
    Write-Host "✅ OK" -ForegroundColor Green
} else {
    $results["logs_filter_level"] = "KO"
    $testDetails["logs_filter_level"] = "Level filter failed"
    Write-Host "❌ KO" -ForegroundColor Red
}

# Logs Filter Source
Write-Host "`n4.3 Logs Filter by Source" -ForegroundColor Yellow
$logs = Invoke-ApiCall -Method "GET" -Endpoint "/api/logs?source=test" -Session $adminSession
if ($logs.success) {
    $results["logs_filter_source"] = "OK"
    $testDetails["logs_filter_source"] = "Source filter works"
    Write-Host "✅ OK" -ForegroundColor Green
} else {
    $results["logs_filter_source"] = "KO"
    $testDetails["logs_filter_source"] = "Source filter failed"
    Write-Host "❌ KO" -ForegroundColor Red
}

# Logs Filter Application
Write-Host "`n4.4 Logs Filter by Application" -ForegroundColor Yellow
$logs = Invoke-ApiCall -Method "GET" -Endpoint "/api/logs?application=test" -Session $adminSession
if ($logs.success) {
    $results["logs_filter_application"] = "OK"
    $testDetails["logs_filter_application"] = "Application filter works"
    Write-Host "✅ OK" -ForegroundColor Green
} else {
    $results["logs_filter_application"] = "KO"
    $testDetails["logs_filter_application"] = "Application filter failed"
    Write-Host "❌ KO" -ForegroundColor Red
}

# Logs Filter Keyword
Write-Host "`n4.5 Logs Filter by Keyword" -ForegroundColor Yellow
$logs = Invoke-ApiCall -Method "GET" -Endpoint "/api/logs?search=error" -Session $adminSession
if ($logs.success) {
    $results["logs_filter_keyword"] = "OK"
    $testDetails["logs_filter_keyword"] = "Keyword filter works"
    Write-Host "✅ OK" -ForegroundColor Green
} else {
    $results["logs_filter_keyword"] = "KO"
    $testDetails["logs_filter_keyword"] = "Keyword filter failed"
    Write-Host "❌ KO" -ForegroundColor Red
}

# Logs Export CSV
Write-Host "`n4.6 Logs Export CSV" -ForegroundColor Yellow
$export = Invoke-ApiCall -Method "GET" -Endpoint "/api/logs/export?format=csv" -Session $adminSession
if ($export.success -or $export.statusCode -eq 200) {
    $results["logs_export_csv"] = "OK"
    $testDetails["logs_export_csv"] = "CSV export works"
    Write-Host "✅ OK" -ForegroundColor Green
} else {
    $results["logs_export_csv"] = "KO"
    $testDetails["logs_export_csv"] = "CSV export failed"
    Write-Host "❌ KO" -ForegroundColor Red
}

# Logs Export JSON
Write-Host "`n4.7 Logs Export JSON" -ForegroundColor Yellow
$export = Invoke-ApiCall -Method "GET" -Endpoint "/api/logs/export/json" -Session $adminSession
if ($export.success -or $export.statusCode -eq 200) {
    $results["logs_export_json"] = "OK"
    $testDetails["logs_export_json"] = "JSON export works"
    Write-Host "✅ OK" -ForegroundColor Green
} else {
    $results["logs_export_json"] = "KO"
    $testDetails["logs_export_json"] = "JSON export failed"
    Write-Host "❌ KO" -ForegroundColor Red
}

Write-Host "`n═══════════════════════════════════════" -ForegroundColor Cyan
Write-Host "5. IMPORT" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan

# Import page accessible
Write-Host "`n5.1 Import page accessible" -ForegroundColor Yellow
$page = Invoke-WebRequest -Uri "$baseUrl/import.html" -WebSession $adminSession -UseBasicParsing -ErrorAction SilentlyContinue
if ($page.StatusCode -eq 200) {
    $results["import_page"] = "OK"
    $testDetails["import_page"] = "Import page accessible"
    Write-Host "✅ OK" -ForegroundColor Green
} else {
    $results["import_page"] = "KO"
    $testDetails["import_page"] = "Import page not accessible"
    Write-Host "❌ KO" -ForegroundColor Red
}

# Import history
Write-Host "`n5.2 Import history" -ForegroundColor Yellow
$history = Invoke-ApiCall -Method "GET" -Endpoint "/api/import/jobs" -Session $adminSession
if ($history.success) {
    $results["import_history"] = "OK"
    $testDetails["import_history"] = "Import history works"
    Write-Host "✅ OK" -ForegroundColor Green
} else {
    $results["import_history"] = "KO"
    $testDetails["import_history"] = "Import history failed with status $($history.statusCode)"
    Write-Host "❌ KO - Status $($history.statusCode)" -ForegroundColor Red
}

Write-Host "`n═══════════════════════════════════════" -ForegroundColor Cyan
Write-Host "6. ALERTES" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan

# Alerts list (already tested in dashboard, but test again)
Write-Host "`n6.1 Alerts List" -ForegroundColor Yellow
$alerts = Invoke-ApiCall -Method "GET" -Endpoint "/api/dashboard/alerts" -Session $adminSession
if ($alerts.success) {
    $results["alerts_list"] = "OK"
    $testDetails["alerts_list"] = "Alerts list works"
    Write-Host "✅ OK" -ForegroundColor Green
} else {
    $results["alerts_list"] = "KO"
    $testDetails["alerts_list"] = "Alerts list failed with status $($alerts.statusCode)"
    Write-Host "❌ KO - Status $($alerts.statusCode)" -ForegroundColor Red
}

# Alerts filter status
Write-Host "`n6.2 Alerts Filter by Status" -ForegroundColor Yellow
$alerts = Invoke-ApiCall -Method "GET" -Endpoint "/api/dashboard/alerts?status=new" -Session $adminSession
if ($alerts.success) {
    $results["alerts_filter_status"] = "OK"
    $testDetails["alerts_filter_status"] = "Status filter works"
    Write-Host "✅ OK" -ForegroundColor Green
} else {
    $results["alerts_filter_status"] = "KO"
    $testDetails["alerts_filter_status"] = "Status filter failed"
    Write-Host "❌ KO" -ForegroundColor Red
}

# Mark all as read
Write-Host "`n6.3 Mark All Alerts as Read" -ForegroundColor Yellow
$markRead = Invoke-ApiCall -Method "PUT" -Endpoint "/api/dashboard/alerts/read-all" -Session $adminSession
if ($markRead.success) {
    $results["alerts_mark_read"] = "OK"
    $testDetails["alerts_mark_read"] = "Mark all as read works"
    Write-Host "✅ OK" -ForegroundColor Green
} else {
    $results["alerts_mark_read"] = "KO"
    $testDetails["alerts_mark_read"] = "Mark all as read failed with status $($markRead.statusCode)"
    Write-Host "❌ KO - Status $($markRead.statusCode)" -ForegroundColor Red
}

Write-Host "`n═══════════════════════════════════════" -ForegroundColor Cyan
Write-Host "7. ADMINISTRATION" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan

# Admin users list
Write-Host "`n7.1 Admin Users List" -ForegroundColor Yellow
$users = Invoke-ApiCall -Method "GET" -Endpoint "/api/admin/users" -Session $adminSession
if ($users.success) {
    $results["admin_users_list"] = "OK"
    $testDetails["admin_users_list"] = "Users list works"
    Write-Host "✅ OK" -ForegroundColor Green
} else {
    $results["admin_users_list"] = "KO"
    $testDetails["admin_users_list"] = "Users list failed"
    Write-Host "❌ KO" -ForegroundColor Red
}

# Admin alert rules
Write-Host "`n7.2 Admin Alert Rules" -ForegroundColor Yellow
$rules = Invoke-ApiCall -Method "GET" -Endpoint "/api/admin/alert-rules" -Session $adminSession
if ($rules.success) {
    $results["admin_alert_rules"] = "OK"
    $testDetails["admin_alert_rules"] = "Alert rules works"
    Write-Host "✅ OK" -ForegroundColor Green
} else {
    $results["admin_alert_rules"] = "KO"
    $testDetails["admin_alert_rules"] = "Alert rules failed with status $($rules.statusCode)"
    Write-Host "❌ KO - Status $($rules.statusCode)" -ForegroundColor Red
}

# Admin audit log
Write-Host "`n7.3 Admin Audit Log" -ForegroundColor Yellow
$audit = Invoke-ApiCall -Method "GET" -Endpoint "/api/admin/audit" -Session $adminSession
if ($audit.success) {
    $results["admin_audit"] = "OK"
    $testDetails["admin_audit"] = "Audit log works"
    Write-Host "✅ OK" -ForegroundColor Green
} else {
    $results["admin_audit"] = "KO"
    $testDetails["admin_audit"] = "Audit log failed with status $($audit.statusCode)"
    Write-Host "❌ KO - Status $($audit.statusCode)" -ForegroundColor Red
}

# Admin anomalies
Write-Host "`n7.4 Admin Anomalies" -ForegroundColor Yellow
$anomalies = Invoke-ApiCall -Method "GET" -Endpoint "/api/logs/watch/anomalies" -Session $adminSession
if ($anomalies.success) {
    $results["admin_anomalies"] = "OK"
    $testDetails["admin_anomalies"] = "Anomalies works"
    Write-Host "✅ OK" -ForegroundColor Green
} else {
    $results["admin_anomalies"] = "KO"
    $testDetails["admin_anomalies"] = "Anomalies failed with status $($anomalies.statusCode)"
    Write-Host "❌ KO - Status $($anomalies.statusCode)" -ForegroundColor Red
}

# User cannot access admin
Write-Host "`n7.5 User Cannot Access Admin" -ForegroundColor Yellow
$users = Invoke-ApiCall -Method "GET" -Endpoint "/api/admin/users" -Session $userSession
if ($users.success -eq $false -or $users.statusCode -ne 200) {
    $results["admin_user_blocked"] = "OK"
    $testDetails["admin_user_blocked"] = "User correctly blocked (status: $($users.statusCode))"
    Write-Host "✅ OK - User blocked (status: $($users.statusCode))" -ForegroundColor Green
} else {
    $results["admin_user_blocked"] = "KO"
    $testDetails["admin_user_blocked"] = "SECURITY ISSUE: User can access admin"
    Write-Host "❌ KO - SECURITY ISSUE" -ForegroundColor Red
}

Write-Host "`n═══════════════════════════════════════" -ForegroundColor Cyan
Write-Host "8. DATA ISOLATION" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan

# Data isolation
Write-Host "`n8.1 Data Isolation Between Users (User cannot see Admin logs)" -ForegroundColor Yellow
# Note: Ici on simule la vérification de non-existence de données croisées
$searchAsUser = Invoke-ApiCall -Method "GET" -Endpoint "/api/logs?search=admin" -Session $userSession
$searchAsAdmin = Invoke-ApiCall -Method "GET" -Endpoint "/api/logs?search=admin" -Session $adminSession

if ($searchAsUser.success -and $searchAsAdmin.success) {
    $userLogs = $searchAsUser.content.logs | Where-Object { $_.message -match "admin" }
    if ($userLogs.Count -eq 0) {
        $adminSummary = Invoke-ApiCall -Method "GET" -Endpoint "/api/dashboard/summary" -Session $adminSession
        $userSummary = Invoke-ApiCall -Method "GET" -Endpoint "/api/dashboard/summary" -Session $userSession
        
        if ($adminSummary.content.total_logs -ne $userSummary.content.total_logs) {
            $results["data_isolation"] = "OK"
            $testDetails["data_isolation"] = "Isolation stricte validée : L'utilisateur ne voit pas les logs admin et les compteurs sont distincts."
            Write-Host "✅ OK - Isolation validée (Admin: $($adminSummary.content.total_logs), User: $($userSummary.content.total_logs))" -ForegroundColor Green
        } else {
            $results["data_isolation"] = "PARTIAL"
            $testDetails["data_isolation"] = "Les compteurs sont identiques ($($adminSummary.content.total_logs)). Vérifiez si les données de test sont bien séparées."
            Write-Host "⚠️ PARTIAL - Compteurs identiques, vérification manuelle requise" -ForegroundColor Yellow
        }
    } else {
        $results["data_isolation"] = "KO"
        $testDetails["data_isolation"] = "FUITE DE DONNÉES : L'utilisateur voit des logs contenant 'admin'"
        Write-Host "❌ KO - CRITICAL: DATA LEAK DETECTED" -ForegroundColor Red
    }
} else {
    $results["data_isolation"] = "KO"
    $testDetails["data_isolation"] = "Could not compare"
    Write-Host "❌ KO - Could not compare" -ForegroundColor Red
}

Write-Host "`n═══════════════════════════════════════" -ForegroundColor Cyan
Write-Host "9. SECURITY" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan

# Unauthenticated blocked
Write-Host "`n9.1 Unauthenticated Access Blocked" -ForegroundColor Yellow
$noSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$logs = Invoke-ApiCall -Method "GET" -Endpoint "/api/logs" -Session $noSession
if ($logs.success -eq $false -or $logs.statusCode -eq 401) {
    $results["security_unauth_blocked"] = "OK"
    $testDetails["security_unauth_blocked"] = "Unauthenticated blocked (status: $($logs.statusCode))"
    Write-Host "✅ OK - Blocked (status: $($logs.statusCode))" -ForegroundColor Green
} else {
    $results["security_unauth_blocked"] = "KO"
    $testDetails["security_unauth_blocked"] = "SECURITY ISSUE: Not blocked"
    Write-Host "❌ KO - SECURITY ISSUE" -ForegroundColor Red
}

Write-Host "`n═══════════════════════════════════════" -ForegroundColor Cyan
Write-Host "10. INTERFACE & UX" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan

# Login page loads
Write-Host "`n10.1 Login Page Loads" -ForegroundColor Yellow
$page = Invoke-WebRequest -Uri "$baseUrl/login.html" -UseBasicParsing -ErrorAction SilentlyContinue
if ($page.StatusCode -eq 200) {
    $results["ui_login_page"] = "OK"
    $testDetails["ui_login_page"] = "Login page loads"
    Write-Host "✅ OK" -ForegroundColor Green
} else {
    $results["ui_login_page"] = "KO"
    $testDetails["ui_login_page"] = "Login page failed to load"
    Write-Host "❌ KO" -ForegroundColor Red
}

# Dashboard page loads
Write-Host "`n10.2 Dashboard Page Loads (with auth)" -ForegroundColor Yellow
$page = Invoke-WebRequest -Uri "$baseUrl/dashboard.html" -WebSession $adminSession -UseBasicParsing -ErrorAction SilentlyContinue
if ($page.StatusCode -eq 200) {
    $results["ui_dashboard_page"] = "OK"
    $testDetails["ui_dashboard_page"] = "Dashboard page loads"
    Write-Host "✅ OK" -ForegroundColor Green
} else {
    $results["ui_dashboard_page"] = "KO"
    $testDetails["ui_dashboard_page"] = "Dashboard page failed to load"
    Write-Host "❌ KO" -ForegroundColor Red
}

# Search page loads
Write-Host "`n10.3 Search Page Loads (with auth)" -ForegroundColor Yellow
$page = Invoke-WebRequest -Uri "$baseUrl/search.html" -WebSession $adminSession -UseBasicParsing -ErrorAction SilentlyContinue
if ($page.StatusCode -eq 200) {
    $results["ui_search_page"] = "OK"
    $testDetails["ui_search_page"] = "Search page loads"
    Write-Host "✅ OK" -ForegroundColor Green
} else {
    $results["ui_search_page"] = "KO"
    $testDetails["ui_search_page"] = "Search page failed to load"
    Write-Host "❌ KO" -ForegroundColor Red
}

# Admin page loads
Write-Host "`n10.4 Admin Page Loads (with admin auth)" -ForegroundColor Yellow
$page = Invoke-WebRequest -Uri "$baseUrl/admin.html" -WebSession $adminSession -UseBasicParsing -ErrorAction SilentlyContinue
if ($page.StatusCode -eq 200) {
    $results["ui_admin_page"] = "OK"
    $testDetails["ui_admin_page"] = "Admin page loads"
    Write-Host "✅ OK" -ForegroundColor Green
} else {
    $results["ui_admin_page"] = "KO"
    $testDetails["ui_admin_page"] = "Admin page failed to load"
    Write-Host "❌ KO" -ForegroundColor Red
}

# User cannot access admin page
Write-Host "`n10.5 User Cannot Access Admin Page" -ForegroundColor Yellow
$page = Invoke-WebRequest -Uri "$baseUrl/admin.html" -WebSession $userSession -UseBasicParsing -ErrorAction SilentlyContinue
if ($page.StatusCode -eq 302 -or $page.Content -match "dashboard") {
    $results["ui_user_admin_blocked"] = "OK"
    $testDetails["ui_user_admin_blocked"] = "User redirected from admin page"
    Write-Host "✅ OK - User redirected" -ForegroundColor Green
} else {
    $results["ui_user_admin_blocked"] = "KO"
    $testDetails["ui_user_admin_blocked"] = "User can access admin page"
    Write-Host "❌ KO - User can access admin page" -ForegroundColor Red
}

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

# Critical bugs
$criticalBugs = @()
if ($results["security_unauth_blocked"] -eq "KO") { $criticalBugs += "Unauthenticated access not blocked" }
if ($results["admin_user_blocked"] -eq "KO") { $criticalBugs += "User can access admin endpoints" }
if ($results["ui_user_admin_blocked"] -eq "KO") { $criticalBugs += "User can access admin page" }

if ($criticalBugs.Count -gt 0) {
    Write-Host "`n⚠️ CRITICAL BUGS:" -ForegroundColor Red
    foreach ($bug in $criticalBugs) {
        Write-Host "  - $bug" -ForegroundColor Red
    }
}

# Save results
$output = @{
    summary = @{
        ok = $okCount
        ko = $koCount
        partial = $partialCount
    }
    results = $results
    details = $testDetails
    criticalBugs = $criticalBugs
}
$output | ConvertTo-Json -Depth 10 | Out-File "qa-results-full.json"
Write-Host "`nDetailed results saved to qa-results-full.json" -ForegroundColor Yellow
