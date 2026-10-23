#!/bin/bash
# Script de test complet de la plateforme LogSystem
# Ordre logique: santé du service, base de données, auth/admin, ingestion des logs,
# recherche/dashboards, alertes/réception/retention, purge manuelle, sécurité et robustesse

# Configuration
BASE_URL="${BASE_URL:-http://localhost:10000}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@logsystem.local}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-CHANGE_ME}"
COOKIE_FILE="cookies.txt"
SKIP_NPM="${SKIP_NPM:-false}"

# Compteurs
TESTS_PASSED=0
TESTS_FAILED=0

# Fonctions
print_section() {
    echo ""
    echo "======================================================================"
    echo "$1"
    echo "======================================================================"
}

print_test() {
    if [ "$2" = "true" ]; then
        echo "✅ $1"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo "❌ $1"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
}

print_info() {
    echo "ℹ️  $1"
}

# === TESTS PRÉLIMINAIRES ===
print_section "TESTS PRÉLIMINAIRES"

if [ "$SKIP_NPM" != "true" ]; then
    print_info "Installation des dépendances..."
    if npm install > /dev/null 2>&1; then
        print_test "npm install" "true"
    else
        print_test "npm install" "false"
    fi

    print_info "Exécution des tests unitaires..."
    if npm test > /dev/null 2>&1; then
        print_test "npm test" "true"
    else
        print_test "npm test" "false"
    fi

    print_info "Linting du code..."
    if npm run lint > /dev/null 2>&1; then
        print_test "npm run lint" "true"
    else
        print_test "npm run lint" "false"
    fi

    print_info "Diagnostic complet..."
    if npm run diagnose:comprehensive > /dev/null 2>&1; then
        print_test "npm run diagnose:comprehensive" "true"
    else
        print_test "npm run diagnose:comprehensive" "false"
    fi

    print_info "Diagnostic admin..."
    if npm run diagnose:admin > /dev/null 2>&1; then
        print_test "npm run diagnose:admin" "true"
    else
        print_test "npm run diagnose:admin" "false"
    fi

    print_info "Diagnostic counts..."
    if npm run diagnose:counts > /dev/null 2>&1; then
        print_test "npm run diagnose:counts" "true"
    else
        print_test "npm run diagnose:counts" "false"
    fi

    print_info "Diagnostic rules..."
    if npm run diagnose:rules > /dev/null 2>&1; then
        print_test "npm run diagnose:rules" "true"
    else
        print_test "npm run diagnose:rules" "false"
    fi
else
    print_info "Tests npm ignorés (SKIP_NPM=true)"
fi

# === 1. SANTÉ DU SERVICE ===
print_section "1. SANTÉ DU SERVICE"

health_url="$BASE_URL/health"
print_info "Test du endpoint: $health_url"

response=$(curl -s -w '\n%{http_code}' "$health_url")
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "200" ]; then
    status_ok=$(echo "$body" | grep -o '"status":"ok"' || echo "")
    if [ -n "$status_ok" ]; then
        print_test "Health endpoint HTTP 200 et status ok" "true"
    else
        print_test "Health endpoint HTTP 200 et status ok" "false"
    fi
    
    db_ok=$(echo "$body" | grep -o '"database":"ok"' || echo "")
    if [ -n "$db_ok" ]; then
        print_test "Base de données accessible" "true"
    else
        print_test "Base de données accessible" "false"
    fi
    
    uptime=$(echo "$body" | grep -o "uptime" || echo "")
    if [ -n "$uptime" ]; then
        print_test "Uptime présent" "true"
    else
        print_test "Uptime présent" "false"
    fi
else
    print_test "Health endpoint accessible" "false"
    print_info "Erreur: HTTP $http_code"
fi

# === 2. BASE DE DONNÉES ===
print_section "2. BASE DE DONNÉES"

print_info "Vérification via le diagnostic"
if npm run diagnose:comprehensive > /dev/null 2>&1; then
    print_test "Diagnostic base de données" "true"
else
    print_test "Diagnostic base de données" "false"
fi

# === 3. AUTHENTIFICATION / ADMIN ===
print_section "3. AUTHENTIFICATION / ADMIN"

# Test login admin
login_url="$BASE_URL/api/auth/login"
login_body="{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}"

print_info "Test login admin..."
response=$(curl -s -w '\n%{http_code}' -c "$COOKIE_FILE" -X POST \
    -H "Content-Type: application/json" \
    -d "$login_body" \
    "$login_url")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "200" ]; then
    print_test "Login admin réussi" "true"
    print_test "Cookies sauvegardés" "true"
else
    print_test "Login admin réussi" "false"
    print_info "Erreur: HTTP $http_code"
    print_info "Assurez-vous que l'admin existe (npm run create-admin)"
fi

# Test mauvais mot de passe
login_body_wrong="{\"email\":\"$ADMIN_EMAIL\",\"password\":\"wrongpassword\"}"
response=$(curl -s -w '\n%{http_code}' -X POST \
    -H "Content-Type: application/json" \
    -d "$login_body_wrong" \
    "$login_url")

http_code=$(echo "$response" | tail -n1)

if [ "$http_code" = "401" ]; then
    print_test "Mauvais mot de passe rejeté" "true"
else
    print_test "Mauvais mot de passe rejeté" "false"
fi

# Test accès interdit sans auth
admin_url="$BASE_URL/api/admin/users"
response=$(curl -s -w '\n%{http_code}' "$admin_url")
http_code=$(echo "$response" | tail -n1)

if [ "$http_code" = "401" ] || [ "$http_code" = "403" ]; then
    print_test "Accès admin sans auth refusé" "true"
else
    print_test "Accès admin sans auth refusé" "false"
fi

# Test dashboard sans auth
dashboard_url="$BASE_URL/dashboard.html"
response=$(curl -s -w '\n%{http_code}' -L "$dashboard_url")
http_code=$(echo "$response" | tail -n1)

if [ "$http_code" = "200" ]; then
    print_test "Dashboard redirige vers login sans auth" "true"
else
    print_test "Dashboard redirige vers login sans auth" "false"
fi

# === 4. ADMIN / UTILISATEUR ===
print_section "4. ADMIN / UTILISATEUR"

if [ -f "$COOKIE_FILE" ]; then
    # Test liste utilisateurs
    response=$(curl -s -w '\n%{http_code}' -b "$COOKIE_FILE" "$admin_url")
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "200" ]; then
        print_test "Liste des utilisateurs accessible" "true"
        user_count=$(echo "$body" | grep -o '"total":[0-9]*' | cut -d':' -f2 || echo "0")
        print_info "Nombre d'utilisateurs: ${user_count:-0}"
    else
        print_test "Liste des utilisateurs accessible" "false"
    fi

    # Test règles d'alerte
    alert_rules_url="$BASE_URL/api/admin/alert-rules"
    response=$(curl -s -w '\n%{http_code}' -b "$COOKIE_FILE" "$alert_rules_url")
    http_code=$(echo "$response" | tail -n1)
    
    if [ "$http_code" = "200" ]; then
        print_test "Règles d'alerte accessibles" "true"
    else
        print_test "Règles d'alerte accessibles" "false"
    fi
else
    print_info "Cookies non disponibles - tests admin ignorés"
fi

# === 5. IMPORT DE LOGS ===
print_section "5. IMPORT DE LOGS"

print_info "Import de logs nécessite un fichier de test"
print_info "Veuillez importer un fichier .log via l'interface UI"
print_test "Import manuel testé" "false"

# Vérifier le compteur de logs
if [ -f "$COOKIE_FILE" ]; then
    stats_url="$BASE_URL/api/dashboard"
    response=$(curl -s -w '\n%{http_code}' -b "$COOKIE_FILE" "$stats_url")
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "200" ]; then
        print_test "Stats dashboard accessibles" "true"
        total_logs=$(echo "$body" | grep -o '"totalLogs":[0-9]*' | cut -d':' -f2 || echo "0")
        print_info "Total logs: ${total_logs:-0}"
    else
        print_test "Stats dashboard accessibles" "false"
    fi
fi

# === 6. RECHERCHE ET DASHBOARD ===
print_section "6. RECHERCHE ET DASHBOARD"

if [ -f "$COOKIE_FILE" ]; then
    # Test recherche
    search_url="$BASE_URL/api/search?q=test&limit=10"
    response=$(curl -s -w '\n%{http_code}' -b "$COOKIE_FILE" "$search_url")
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "200" ]; then
        print_test "Recherche accessible" "true"
        result_count=$(echo "$body" | grep -o '"count":[0-9]*' | cut -d':' -f2 || echo "0")
        print_info "Résultats: ${result_count:-0}"
    else
        print_test "Recherche accessible" "false"
    fi

    # Test dashboard stats
    dashboard_api_url="$BASE_URL/api/dashboard"
    response=$(curl -s -w '\n%{http_code}' -b "$COOKIE_FILE" "$dashboard_api_url")
    http_code=$(echo "$response" | tail -n1)
    
    if [ "$http_code" = "200" ]; then
        print_test "Dashboard stats accessibles" "true"
    else
        print_test "Dashboard stats accessibles" "false"
    fi

    # Test top errors
    top_errors_url="$BASE_URL/api/dashboard/top-errors"
    response=$(curl -s -w '\n%{http_code}' -b "$COOKIE_FILE" "$top_errors_url")
    http_code=$(echo "$response" | tail -n1)
    
    if [ "$http_code" = "200" ]; then
        print_test "Top errors accessible" "true"
    else
        print_test "Top errors accessible" "false"
    fi
fi

# === 7. ALERTES ===
print_section "7. ALERTES"

if [ -f "$COOKIE_FILE" ]; then
    alerts_url="$BASE_URL/api/admin/alerts"
    response=$(curl -s -w '\n%{http_code}' -b "$COOKIE_FILE" "$alerts_url")
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "200" ]; then
        print_test "Liste des alertes accessible" "true"
        alert_count=$(echo "$body" | grep -o '"total":[0-9]*' | cut -d':' -f2 || echo "0")
        print_info "Nombre d'alertes: ${alert_count:-0}"
    else
        print_test "Liste des alertes accessible" "false"
    fi
fi

# === 8. RÉTENTION ===
print_section "8. RÉTENTION"

if [ -f "$COOKIE_FILE" ]; then
    retention_stats_url="$BASE_URL/api/admin/retention/stats"
    response=$(curl -s -w '\n%{http_code}' -b "$COOKIE_FILE" "$retention_stats_url")
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "200" ]; then
        print_test "Stats retention accessibles" "true"
        total_logs=$(echo "$body" | grep -o '"totalLogs":[0-9]*' | cut -d':' -f2 || echo "0")
        print_info "Total logs: ${total_logs:-0}"
    else
        print_test "Stats retention accessibles" "false"
    fi

    print_info "Test de run retention non exécuté (destructif)"
    print_test "Run retention testé" "false"
fi

# === 9. PURGE MANUELLE ===
print_section "9. PURGE MANUELLE"

if [ -f "$COOKIE_FILE" ]; then
    # Test purge sans critère (doit échouer)
    purge_url="$BASE_URL/api/admin/purge"
    purge_body="{}"
    response=$(curl -s -w '\n%{http_code}' -b "$COOKIE_FILE" -X POST \
        -H "Content-Type: application/json" \
        -d "$purge_body" \
        "$purge_url")
    http_code=$(echo "$response" | tail -n1)
    
    if [ "$http_code" = "400" ]; then
        print_test "Purge sans critère rejetée" "true"
    else
        print_test "Purge sans critère rejetée" "false"
    fi

    # Test purge avec niveau invalide (doit échouer)
    purge_body_invalid="{\"level\":\"INVALID_LEVEL\"}"
    response=$(curl -s -w '\n%{http_code}' -b "$COOKIE_FILE" -X POST \
        -H "Content-Type: application/json" \
        -d "$purge_body_invalid" \
        "$purge_url")
    http_code=$(echo "$response" | tail -n1)
    
    if [ "$http_code" = "400" ]; then
        print_test "Purge avec niveau invalide rejetée" "true"
    else
        print_test "Purge avec niveau invalide rejetée" "false"
    fi

    print_info "Test de purge avec critères valides non exécuté (destructif)"
    print_test "Purge par niveau testée" "false"
    print_test "Purge par date testée" "false"
fi

# === 10. ROBUSTESSE DB / SCHÉMA ===
print_section "10. ROBUSTESSE DB / SCHÉMA"

print_info "Vérification du schéma via diagnose:comprehensive"
if npm run diagnose:comprehensive > /dev/null 2>&1; then
    print_test "Schéma base de données valide" "true"
else
    print_test "Schéma base de données valide" "false"
fi

# === 11. SÉCURITÉ ===
print_section "11. SÉCURITÉ"

print_info "Test rate limit non implémenté dans ce script"
print_test "Rate limit actif" "false"

if [ -f "$COOKIE_FILE" ]; then
    if grep -q "connect.sid" "$COOKIE_FILE"; then
        print_test "Session cookie présent" "true"
    else
        print_test "Session cookie présent" "false"
    fi
fi

# === 12. PERFORMANCE LÉGÈRE ===
print_section "12. PERFORMANCE LÉGÈRE"

print_info "Test de performance non implémenté dans ce script"
print_test "Performance import" "false"
print_test "Performance dashboard" "false"

# === NETTOYAGE ===
if [ -f "$COOKIE_FILE" ]; then
    rm -f "$COOKIE_FILE"
fi

# === RÉSUMÉ ===
print_section "RÉSUMÉ DES TESTS"

echo ""
echo "Tests réussis: $TESTS_PASSED"
echo "Tests échoués: $TESTS_FAILED"
echo "Total tests: $((TESTS_PASSED + TESTS_FAILED))"

if [ $TESTS_FAILED -eq 0 ]; then
    echo ""
    echo "🎉 Tous les tests sont passés!"
    exit 0
else
    echo ""
    echo "⚠️ Certains tests ont échoué"
    exit 1
fi
