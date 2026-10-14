@echo off
REM Script de démarrage Docker pour LogSystem avec MySQL 8 (Windows)

setlocal enabledelayedexpansion

echo ========================================
echo LogSystem - Démarrage avec Docker
echo ========================================
echo.

REM Vérifier si Docker est installé
where docker >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERREUR] Docker n'est pas installé
    echo Installez Docker Desktop depuis https://www.docker.com/products/docker-desktop
    pause
    exit /b 1
)

REM Vérifier si Docker Compose est installé
docker compose version >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERREUR] Docker Compose n'est pas installé
    echo Docker Compose est inclus dans Docker Desktop
    pause
    exit /b 1
)

echo [OK] Docker et Docker Compose sont installés
echo.

REM Arrêter les conteneurs existants
echo [INFO] Arrêt des conteneurs existants...
docker compose down 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [INFO] Aucun conteneur existant
)

REM Construire les images
echo [INFO] Construction des images Docker...
docker compose build
if %ERRORLEVEL% NEQ 0 (
    echo [ERREUR] Erreur lors de la construction des images
    pause
    exit /b 1
)

REM Démarrer les services
echo [INFO] Démarrage des services (MySQL, Redis, LogSystem)...
docker compose up -d
if %ERRORLEVEL% NEQ 0 (
    echo [ERREUR] Erreur lors du démarrage des services
    pause
    exit /b 1
)

echo.
echo ========================================
echo LogSystem est en cours de démarrage
echo ========================================
echo.
echo Services:
echo   - MySQL: localhost:3306
echo   - Redis: localhost:6379
echo   - LogSystem: http://localhost:10000
echo.
echo Attendez 30-60 secondes pour que les services démarrent...
echo.

REM Attendre que MySQL soit prêt
echo [INFO] Attente de MySQL...
set /a count=0
:wait_mysql
docker exec logsystem-mysql mysqladmin ping -h localhost -u root -pLogSystem2024! >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo [OK] MySQL est prêt
    goto wait_app
)
set /a count+=1
if %count% LEQ 30 (
    echo   - Tentative !count!/30...
    timeout /t 2 /nobreak >nul
    goto wait_mysql
)
echo [AVERTISSEMENT] MySQL ne semble pas prêt, continuation...

REM Attendre que l'application soit prête
:wait_app
echo [INFO] Attente de LogSystem...
set /a count=0
:wait_app_loop
curl -f http://localhost:10000/health >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo [OK] LogSystem est prêt
    goto success
)
set /a count+=1
if %count% LEQ 30 (
    echo   - Tentative !count!/30...
    timeout /t 2 /nobreak >nul
    goto wait_app_loop
)
echo [AVERTISSEMENT] LogSystem ne semble pas prêt, vérifiez les logs

:success
echo.
echo ========================================
echo ✓ LogSystem est démarré avec succès !
echo ========================================
echo.
echo Accès:
echo   - Application: http://localhost:10000
echo   - Login par défaut:
echo     Email: admin@logsystem.local
echo     Mot de passe: CHANGE_THIS_STRONG_PASSWORD_IMMEDIATELY
echo.
echo Commandes utiles:
echo   - Voir les logs: docker compose logs -f
echo   - Arrêter: docker compose down
echo   - Redémarrer: docker compose restart
echo   - Accéder à MySQL: docker exec -it logsystem-mysql mysql -u root -p
echo.
pause
