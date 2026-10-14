@echo off
REM Script de démarrage pour LogSystem avec Apache sur Windows
REM Ce script démarre Apache et le backend Node.js

echo ========================================
echo LogSystem - Démarrage du serveur
echo ========================================
echo.

REM Vérifier si Node.js est installé
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERREUR] Node.js n'est pas installé ou n'est pas dans le PATH
    echo Veuillez installer Node.js depuis https://nodejs.org/
    pause
    exit /b 1
)

echo [OK] Node.js trouvé
node --version
echo.

REM Vérifier si les dépendances sont installées
if not exist "node_modules\" (
    echo [INFO] Installation des dépendances...
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo [ERREUR] Erreur lors de l'installation des dépendances
        pause
        exit /b 1
    )
    echo [OK] Dépendances installées
    echo.
)

REM Vérifier si .env existe
if not exist ".env" (
    echo [INFO] Fichier .env non trouvé, création à partir de .env.example...
    if exist ".env.example" (
        copy .env.example .env
        echo [AVERTISSEMENT] Veuillez éditer .env avec vos credentials MySQL
        echo.
    ) else (
        echo [ERREUR] Fichier .env.example non trouvé
        pause
        exit /b 1
    )
)

REM Créer le dossier logs si nécessaire
if not exist "logs\" (
    echo [INFO] Création du dossier logs...
    mkdir logs
)

REM Démarrer Apache
echo [INFO] Vérification d'Apache...
where httpd >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo [OK] Apache trouvé
    echo [INFO] Démarrage d'Apache...
    httpd -k start
    if %ERRORLEVEL% EQU 0 (
        echo [OK] Apache démarré avec succès
    ) else (
        echo [AVERTISSEMENT] Apache est peut-être déjà en cours d'exécution
    )
    echo.
) else (
    echo [AVERTISSEMENT] Apache non trouvé dans PATH
    echo Si vous utilisez XAMPP, démarrez Apache via le Control Panel
    echo Sinon, installez Apache ou configurez manuellement
    echo.
)

REM Vérifier la connexion MySQL
echo [INFO] Vérification de la connexion MySQL...
node -e "const pool = require('./config/database.js'); pool.getConnection().then(conn => { console.log('[OK] Connexion MySQL réussie'); conn.release(); process.exit(0); }).catch(err => { console.log('[ERREUR] Connexion MySQL échouée:', err.message); process.exit(1); });"
if %ERRORLEVEL% NEQ 0 (
    echo [ERREUR] Impossible de se connecter à MySQL
    echo Vérifiez votre configuration dans .env
    pause
    exit /b 1
)
echo.

REM Démarrer le backend Node.js
echo [INFO] Démarrage du backend Node.js sur le port 3000...
echo.
echo ========================================
echo LogSystem est en cours de démarrage
echo ========================================
echo.
echo Frontend: http://localhost
echo API: http://localhost:3000/api
echo.
echo Appuyez sur Ctrl+C pour arrêter
echo ========================================
echo.

REM Démarrer Node.js
npm start
