# Global Functional Test - LogSystem Platform
# Tests all main platform features

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
        Write-Host "PASS: $TestName" -ForegroundColor Green
    } else {
        $script:FAILED_TESTS++
        Write-Host "FAIL: $TestName" -ForegroundColor Red
        if ($Details) {
            Write-Host "      $Details" -ForegroundColor Yellow
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
            Headers = $response.Headers
        }
    } catch {
        return @{
            Success = $false
            StatusCode = if ($_.Exception.Response) { $_.Exception.Response.StatusCode.value__ } else { 0 }
            Content = $_.Exception.Message
        }
    }
}

Write-Host "========================================"
Write-Host "GLOBAL FUNCTIONAL TEST - LOGSYSTEM v6.0.0"
Write-Host "========================================"
Write-Host ""

# 1. AUTHENTICATION TESTS
Write-Host "1. AUTHENTICATION TESTS"
Write-Host "----------------------------------------"

$sessionCookie = $null

# Test 1.1: Login with valid credentials
$loginBody = @{
    email = "admin@logsystem.local"
    password = "Admin@1234"
} | ConvertTo-Json

$loginResult = Invoke-ApiCall -Endpoint "/api/auth/login" -Method "POST" -Body $loginBody
Write-TestResult -TestName "Login with valid credentials" -Passed ($loginResult.Success -eq $true) -Details $loginResult.Content

if ($loginResult.Success) {
    $setCookie = $loginResult.Headers["Set-Cookie"]
    if ($setCookie) {
        $sessionCookie = ($setCookie -split ';')[0]
    }
    
    $loginData = $loginResult.Content | ConvertFrom-Json
    $hasUserData = $loginData.id -eq 1 -and $loginData.role -eq "admin"
    Write-TestResult -TestName "Login response contains user data" -Passed $hasUserData
}

# Test 1.2: Login with invalid credentials
$invalidLoginBody = @{
    email = "admin@logsystem.local"
    password = "WrongPassword"
} | ConvertTo-Json

$invalidLoginResult = Invoke-ApiCall -Endpoint "/api/auth/login" -Method "POST" -Body $invalidLoginBody
Write-TestResult -TestName "Login rejects wrong password" -Passed ($invalidLoginResult.Success -eq $false)

# Test 1.3: Check session with /api/me
$headers = @{}
if ($sessionCookie) {
    $headers["Cookie"] = $sessionCookie
}

$meResult = Invoke-ApiCall -Endpoint "/api/auth/me" -Headers $headers
Write-TestResult -TestName "Session check with /api/me" -Passed ($meResult.Success -eq $true)

# 2. DASHBOARD TESTS
Write-Host ""
Write-Host "2. DASHBOARD TESTS"
Write-Host "----------------------------------------"

# Test 2.1: KPI API
$kpiResult = Invoke-ApiCall -Endpoint "/api/dashboard/kpi" -Headers $headers
Write-TestResult -TestName "Dashboard KPI API" -Passed ($kpiResult.Success -eq $true) -Details $kpiResult.Content

if ($kpiResult.Success) {
    $kpiData = $kpiResult.Content | ConvertFrom-Json
    $hasKPI = $kpiData.total -ge 0
    Write-TestResult -TestName "KPI contains data" -Passed $hasKPI
}

# Test 2.2: Trends API
$trendsResult = Invoke-ApiCall -Endpoint "/api/dashboard/trends?days=1" -Headers $headers
Write-TestResult -TestName "Dashboard Trends API" -Passed ($trendsResult.Success -eq $true)

# Test 2.3: Recent logs API
$logsResult = Invoke-ApiCall -Endpoint "/api/dashboard/recent-logs?limit=10" -Headers $headers
Write-TestResult -TestName "Recent logs API" -Passed ($logsResult.Success -eq $true)

if ($logsResult.Success) {
    $logsData = $logsResult.Content | ConvertFrom-Json
    $hasLogs = $logsData.Count -gt 0
    Write-TestResult -TestName "Recent logs returned" -Passed $hasLogs
}

# Test 2.4: Level distribution API
$levelResult = Invoke-ApiCall -Endpoint "/api/dashboard/level-distribution" -Headers $headers
Write-TestResult -TestName "Level distribution API" -Passed ($levelResult.Success -eq $true)

# Test 2.5: Top errors API
$topErrorsResult = Invoke-ApiCall -Endpoint "/api/dashboard/top-errors" -Headers $headers
Write-TestResult -TestName "Top errors API" -Passed ($topErrorsResult.Success -eq $true)

# 3. SEARCH TESTS
Write-Host ""
Write-Host "3. SEARCH TESTS"
Write-Host "----------------------------------------"

# Test 3.1: Simple search
$searchBody = @{
    query = "ERROR"
    limit = 10
} | ConvertTo-Json

$searchResult = Invoke-ApiCall -Endpoint "/api/search" -Method "POST" -Headers $headers -Body $searchBody
Write-TestResult -TestName "Simple search (ERROR)" -Passed ($searchResult.Success -eq $true)

# Test 3.2: Search with filters
$searchFiltersBody = @{
    query = ""
    level = "ERROR"
    limit = 5
} | ConvertTo-Json

$searchFiltersResult = Invoke-ApiCall -Endpoint "/api/search" -Method "POST" -Headers $headers -Body $searchFiltersBody
Write-TestResult -TestName "Search with level filter" -Passed ($searchFiltersResult.Success -eq $true)

# 4. ALERTS TESTS
Write-Host ""
Write-Host "4. ALERTS TESTS"
Write-Host "----------------------------------------"

# Test 4.1: List alerts
$alertsResult = Invoke-ApiCall -Endpoint "/api/dashboard/alerts" -Headers $headers
Write-TestResult -TestName "List alerts API" -Passed ($alertsResult.Success -eq $true)

# Test 4.2: Mark alerts as read
$markReadBody = @{
    alertIds = @()
} | ConvertTo-Json

$markReadResult = Invoke-ApiCall -Endpoint "/api/dashboard/alerts/mark-read" -Method "POST" -Headers $headers -Body $markReadBody
Write-TestResult -TestName "Mark alerts as read API" -Passed ($markReadResult.Success -eq $true)

# 5. ADMIN TESTS
Write-Host ""
Write-Host "5. ADMIN TESTS"
Write-Host "----------------------------------------"

# Test 5.1: List users
$usersResult = Invoke-ApiCall -Endpoint "/api/admin/users" -Headers $headers
Write-TestResult -TestName "List users API" -Passed ($usersResult.Success -eq $true)

# Test 5.2: List alert rules
$rulesResult = Invoke-ApiCall -Endpoint "/api/admin/alert-rules" -Headers $headers
Write-TestResult -TestName "List alert rules API" -Passed ($rulesResult.Success -eq $true)

# Test 5.3: System stats
$statsResult = Invoke-ApiCall -Endpoint "/api/admin/stats" -Headers $headers
Write-TestResult -TestName "System stats API" -Passed ($statsResult.Success -eq $true)

# 6. RECOMMENDATIONS TESTS
Write-Host ""
Write-Host "6. RECOMMENDATIONS TESTS"
Write-Host "----------------------------------------"

# Test 6.1: List recommendations
$recsResult = Invoke-ApiCall -Endpoint "/api/recommendations" -Headers $headers
Write-TestResult -TestName "Recommendations API" -Passed ($recsResult.Success -eq $true)

# 7. WATCHER TESTS
Write-Host ""
Write-Host "7. WATCHER TESTS"
Write-Host "----------------------------------------"

# Test 7.1: Watcher status
$watcherResult = Invoke-ApiCall -Endpoint "/api/watchdogs/status" -Headers $headers
Write-TestResult -TestName "Watcher status API" -Passed ($watcherResult.Success -eq $true)

# 8. LOGOUT TESTS
Write-Host ""
Write-Host "8. LOGOUT TESTS"
Write-Host "----------------------------------------"

# Test 8.1: Logout
$logoutResult = Invoke-ApiCall -Endpoint "/api/auth/logout" -Method "POST" -Headers $headers
Write-TestResult -TestName "Logout API" -Passed ($logoutResult.Success -eq $true)

# Test 8.2: Session invalidated after logout
$meAfterLogout = Invoke-ApiCall -Endpoint "/api/auth/me" -Headers $headers
Write-TestResult -TestName "Session invalidated after logout" -Passed ($meAfterLogout.Success -eq $false)

# FINAL REPORT
Write-Host ""
Write-Host "========================================"
Write-Host "TEST REPORT"
Write-Host "========================================"
Write-Host ""

Write-Host "Total tests: $TOTAL_TESTS"
Write-Host "Passed: $PASSED_TESTS" -ForegroundColor Green
Write-Host "Failed: $FAILED_TESTS" -ForegroundColor Red

$successRate = if ($TOTAL_TESTS -gt 0) { [math]::Round(($PASSED_TESTS / $TOTAL_TESTS) * 100, 2) } else { 0 }
Write-Host "Success rate: $successRate%"

Write-Host ""
Write-Host "Test details:"
$TEST_RESULTS | Format-Table -AutoSize

# Export results
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
Write-Host ""
Write-Host "Report exported: $reportFile" -ForegroundColor Green

if ($FAILED_TESTS -eq 0) {
    Write-Host ""
    Write-Host "ALL TESTS PASSED" -ForegroundColor Green
    exit 0
} else {
    Write-Host ""
    Write-Host "SOME TESTS FAILED" -ForegroundColor Red
    exit 1
}
