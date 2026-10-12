# Test Fonctionnel Dry-Run - LogSystem Platform
# Ce script teste la configuration et la structure sans nécessiter MySQL actif

$ErrorActionPreference = "Stop"
$TestResults = @()
$TestStartTime = Get-Date

# Fonction pour logger les résultats
function Log-TestResult {
    param(
        [string]$TestName,
        [bool]$Passed,
        [string]$Details = ""
    )
    
    $result = [PSCustomObject]@{
        Test = $TestName
        Status = if ($Passed) { "✅ PASS" } else { "❌ FAIL" }
        Details = $Details
        Timestamp = Get-Date
    }
    
    $script:TestResults += $result
    Write-Host "$($result.Status) - $TestName" -ForegroundColor $(if ($Passed) { "Green" } else { "Red" })
    if ($Details) {
        Write-Host "   $Details" -ForegroundColor "Gray"
    }
}

Write-Host "======================================================" -ForegroundColor "Cyan"
Write-Host "  TEST FONCTIONNEL DRY-RUN - LOGSYSTEM PLATFORM" -ForegroundColor "Cyan"
Write-Host "  (Validation de configuration sans serveur actif)" -ForegroundColor "Cyan"
Write-Host "======================================================" -ForegroundColor "Cyan"
Write-Host ""

# Test 1: Structure du projet
Write-Host "MODULE 1: STRUCTURE DU PROJET" -ForegroundColor "Yellow"
Write-Host "----------------------------------------" -ForegroundColor "Yellow"

$requiredDirs = @("config", "middleware", "routes", "services", "workers", "lib", "public", "db", "scripts")
foreach ($dir in $requiredDirs) {
    $exists = Test-Path "D:\COLEPS\code\LogSystem\$dir"
    Log-TestResult -TestName "Dossier $dir" -Passed $exists -Details $(if ($exists) { "Présent" } else { "Manquant" })
}

$requiredFiles = @("server.js", "package.json", ".env", "db/schema.sql")
foreach ($file in $requiredFiles) {
    $exists = Test-Path "D:\COLEPS\code\LogSystem\$file"
    Log-TestResult -TestName "Fichier $file" -Passed $exists -Details $(if ($exists) { "Présent" } else { "Manquant" })
}

Write-Host ""

# Test 2: Configuration
Write-Host "MODULE 2: CONFIGURATION" -ForegroundColor "Yellow"
Write-Host "----------------------------------------" -ForegroundColor "Yellow"

$envFile = "D:\COLEPS\code\LogSystem\.env"
if (Test-Path $envFile) {
    Log-TestResult -TestName "Fichier .env existe" -Passed $true -Details "Configuration présente"
    
    $envContent = Get-Content $envFile
    $requiredEnvVars = @("DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME", "SESSION_SECRET", "CSRF_SECRET")
    
    foreach ($var in $requiredEnvVars) {
        $hasVar = $envContent | Where-Object { $_ -like "$var=*" -and $_ -notlike "*REPLACE_WITH*" }
        Log-TestResult -TestName "Variable $var" -Passed ($null -ne $hasVar) -Details $(if ($hasVar) { "Configurée" } else { "Manquante ou valeur par défaut" })
    }
} else {
    Log-TestResult -TestName "Fichier .env existe" -Passed $false -Details "Fichier de configuration manquant"
}

Write-Host ""

# Test 3: Dépendances
Write-Host "MODULE 3: DÉPENDANCES" -ForegroundColor "Yellow"
Write-Host "----------------------------------------" -ForegroundColor "Yellow"

$packageJson = Get-Content "D:\COLEPS\code\LogSystem\package.json" | ConvertFrom-Json
$requiredDeps = @("express", "mysql2", "bcryptjs", "cookie-parser", "helmet", "multer", "dotenv")

foreach ($dep in $requiredDeps) {
    $hasDep = $packageJson.dependencies.PSObject.Properties.Name -contains $dep
    Log-TestResult -TestName "Dépendance $dep" -Passed $hasDep -Details $(if ($hasDep) { "Installée" } else { "Manquante" })
}

$nodeModulesExists = Test-Path "D:\COLEPS\code\LogSystem\node_modules"
Log-TestResult -TestName "node_modules installé" -Passed $nodeModulesExists -Details $(if ($nodeModulesExists) { "Dépendances téléchargées" } else { "Exécuter: npm install" })

Write-Host ""

# Test 4: Routes API
Write-Host "MODULE 4: ROUTES API" -ForegroundColor "Yellow"
Write-Host "----------------------------------------" -ForegroundColor "Yellow"

$requiredRoutes = @("routes/auth.js", "routes/logs.js", "routes/dashboard.js", "routes/admin.js", "routes/import.js")
foreach ($route in $requiredRoutes) {
    $exists = Test-Path "D:\COLEPS\code\LogSystem\$route"
    Log-TestResult -TestName "Route $route" -Passed $exists -Details $(if ($exists) { "Définie" } else { "Manquante" })
}

Write-Host ""

# Test 5: Pages Frontend
Write-Host "MODULE 5: PAGES FRONTEND" -ForegroundColor "Yellow"
Write-Host "----------------------------------------" -ForegroundColor "Yellow"

$requiredPages = @("public/login.html", "public/dashboard.html", "public/search.html", "public/import.html", "public/admin.html")
foreach ($page in $requiredPages) {
    $exists = Test-Path "D:\COLEPS\code\LogSystem\$page"
    Log-TestResult -TestName "Page $page" -Passed $exists -Details $(if ($exists) { "Présente" } else { "Manquante" })
}

Write-Host ""

# Test 6: Schema Database
Write-Host "MODULE 6: SCHEMA DATABASE" -ForegroundColor "Yellow"
Write-Host "----------------------------------------" -ForegroundColor "Yellow"

$schemaFile = "D:\COLEPS\code\LogSystem\db\schema.sql"
if (Test-Path $schemaFile) {
    Log-TestResult -TestName "Fichier schema.sql" -Passed $true -Details "Présent"
    
    $schemaContent = Get-Content $schemaFile -Raw
    $requiredTables = @("CREATE TABLE.*users", "CREATE TABLE.*logs", "CREATE TABLE.*import_jobs", "CREATE TABLE.*sessions", "CREATE TABLE.*alert_rules")
    
    foreach ($tablePattern in $requiredTables) {
        $hasTable = $schemaContent -match $tablePattern
        $tableName = ($tablePattern -split "CREATE TABLE.*")[1]
        Log-TestResult -TestName "Table $tableName" -Passed $hasTable -Details $(if ($hasTable) { "Définie dans schema" } else { "Non trouvée" })
    }
} else {
    Log-TestResult -TestName "Fichier schema.sql" -Passed $false -Details "Manquant"
}

Write-Host ""

# Test 7: Migrations
Write-Host "MODULE 7: MIGRATIONS" -ForegroundColor "Yellow"
Write-Host "----------------------------------------" -ForegroundColor "Yellow"

$migrationsDir = "D:\COLEPS\code\LogSystem\db\migrations"
if (Test-Path $migrationsDir) {
    $migrationFiles = Get-ChildItem $migrationsDir -Filter "*.sql"
    Log-TestResult -TestName "Dossier migrations" -Passed $true -Details "$($migrationFiles.Count) fichiers SQL"
    
    if ($migrationFiles.Count -gt 0) {
        Log-TestResult -TestName "Migrations disponibles" -Passed $true -Details "Dernière: $($migrationFiles[-1].Name)"
    }
} else {
    Log-TestResult -TestName "Dossier migrations" -Passed $false -Details "Manquant"
}

Write-Host ""

# Test 8: Scripts de maintenance
Write-Host "MODULE 8: SCRIPTS DE MAINTENANCE" -ForegroundColor "Yellow"
Write-Host "----------------------------------------" -ForegroundColor "Yellow"

$requiredScripts = @(
    "scripts/create-default-users.js",
    "scripts/comprehensive-diagnostic.js",
    "scripts/cleanup-database.js",
    "scripts/check-logs-table.js"
)

foreach ($script in $requiredScripts) {
    $exists = Test-Path "D:\COLEPS\code\LogSystem\$script"
    Log-TestResult -TestName "Script $script" -Passed $exists -Details $(if ($exists) { "Disponible" } else { "Manquant" })
}

Write-Host ""

# Test 9: Sécurité
Write-Host "MODULE 9: SÉCURITÉ" -ForegroundColor "Yellow"
Write-Host "----------------------------------------" -ForegroundColor "Yellow"

$middlewareFiles = @("middleware/auth.js", "middleware/csrf.js", "middleware/scopeGuard.js")
foreach ($middleware in $middlewareFiles) {
    $exists = Test-Path "D:\COLEPS\code\LogSystem\$middleware"
    Log-TestResult -TestName "Middleware $middleware" -Passed $exists -Details $(if ($exists) { "Implémenté" } else { "Manquant" })
}

# Vérifier .gitignore
$gitignore = Test-Path "D:\COLEPS\code\LogSystem\.gitignore"
if ($gitignore) {
    $gitignoreContent = Get-Content "D:\COLEPS\code\LogSystem\.gitignore"
    $protectsEnv = $gitignoreContent -contains ".env"
    $protectsNodeModules = $gitignoreContent -contains "node_modules"
    
    $envDetails = if ($protectsEnv) { "Sécurisé" } else { "Non protégé" }
    Log-TestResult -TestName ".gitignore protège .env" -Passed $protectsEnv -Details $envDetails
    
    $nodeModulesDetails = if ($protectsNodeModules) { "Sécurisé" } else { "Non protégé" }
    Log-TestResult -TestName ".gitignore protège node_modules" -Passed $protectsNodeModules -Details $nodeModulesDetails
} else {
    Log-TestResult -TestName ".gitignore existe" -Passed $false -Details "Manquant"
}

Write-Host ""

# Test 10: Validité du code JavaScript
Write-Host "MODULE 10: VALIDITÉ DU CODE" -ForegroundColor "Yellow"
Write-Host "----------------------------------------" -ForegroundColor "Yellow"

try {
    $lintResult = & npm run lint 2>&1
    $lintExitCode = $LASTEXITCODE
    Log-TestResult -TestName "ESLint validation" -Passed ($lintExitCode -eq 0) -Details $(if ($lintExitCode -eq 0) { "Pas d'erreurs lint" } else { "Erreurs de lint détectées" })
} catch {
    Log-TestResult -TestName "ESLint validation" -Passed $false -Details "Erreur d'exécution: $($_.Exception.Message)"
}

Write-Host ""

# Résumé des tests
Write-Host "======================================================" -ForegroundColor "Cyan"
Write-Host "  RÉSUMÉ DES TESTS DRY-RUN" -ForegroundColor "Cyan"
Write-Host "======================================================" -ForegroundColor "Cyan"
Write-Host ""

$passedCount = ($TestResults | Where-Object { $_.Status -eq "✅ PASS" }).Count
$failedCount = ($TestResults | Where-Object { $_.Status -eq "❌ FAIL" }).Count
$totalCount = $TestResults.Count

Write-Host "Total tests: $totalCount" -ForegroundColor "White"
Write-Host "Réussis: $passedCount" -ForegroundColor "Green"
Write-Host "Échoués: $failedCount" -ForegroundColor "Red"
Write-Host ""

$successRate = if ($totalCount -gt 0) { [math]::Round(($passedCount / $totalCount) * 100, 2) } else { 0 }
Write-Host "Taux de réussite: $successRate%" -ForegroundColor $(if ($successRate -ge 80) { "Green" } elseif ($successRate -ge 50) { "Yellow" } else { "Red" })
Write-Host ""

# Détails des tests échoués
if ($failedCount -gt 0) {
    Write-Host "Tests échoués:" -ForegroundColor "Red"
    Write-Host "----------------------------------------" -ForegroundColor "Red"
    $TestResults | Where-Object { $_.Status -eq "❌ FAIL" } | ForEach-Object {
        Write-Host "  ❌ $($_.Test)" -ForegroundColor "Red"
        Write-Host "     $($_.Details)" -ForegroundColor "Gray"
    }
    Write-Host ""
}

# Durée du test
$testDuration = (Get-Date) - $TestStartTime
Write-Host "Durée totale: $($testDuration.ToString('mm\:ss'))" -ForegroundColor "Cyan"
Write-Host ""

# Instructions pour démarrer
Write-Host "======================================================" -ForegroundColor "Cyan"
Write-Host "  INSTRUCTIONS POUR DÉMARRER LA PLATEFORME" -ForegroundColor "Cyan"
Write-Host "======================================================" -ForegroundColor "Cyan"
Write-Host ""

Write-Host "1. Installer MySQL et démarrer le service" -ForegroundColor "Yellow"
Write-Host "2. Créer la base de données:" -ForegroundColor "Yellow"
Write-Host "   CREATE DATABASE logsystem;" -ForegroundColor "Cyan"
Write-Host "3. Exécuter: npm install (si node_modules manquant)" -ForegroundColor "Yellow"
Write-Host "4. Exécuter: npm run create-admin (créer utilisateurs par défaut)" -ForegroundColor "Yellow"
Write-Host "5. Exécuter: npm start (démarrer le serveur)" -ForegroundColor "Yellow"
Write-Host "6. Exécuter: .\test-platform-complete.ps1 (test fonctionnel complet)" -ForegroundColor "Yellow"
Write-Host ""

# Rapport final
if ($failedCount -eq 0) {
    Write-Host "🎉 TOUS LES TESTS DRY-RUN ONT RÉUSSI!" -ForegroundColor "Green"
    Write-Host "La structure du projet est correcte." -ForegroundColor "Green"
    Write-Host "Il ne reste qu'à configurer MySQL et démarrer le serveur." -ForegroundColor "Green"
    exit 0
} elseif ($successRate -ge 80) {
    Write-Host "⚠️ Structure majoritairement correcte mais quelques problèmes mineurs" -ForegroundColor "Yellow"
    exit 1
} else {
    Write-Host "❌ Structure du projet incomplète - Des corrections sont nécessaires" -ForegroundColor "Red"
    exit 1
}
