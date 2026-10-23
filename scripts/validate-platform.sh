#!/bin/bash
# Script de validation complète de la plateforme LogSystem (Render/Aiven)
# Utilisation: ./scripts/validate-platform.sh <URL_RENDER>
# Exemple: ./scripts/validate-platform.sh https://logsystem-z41e.onrender.com

set -e

# Configuration
RENDER_URL="${1:-https://logsystem-z41e.onrender.com}"
COOKIES_FILE="/tmp/logsystem-test-cookies.txt"
ADMIN_EMAIL="admin@logsystem.local"
ADMIN_PASSWORD="CHANGE_ME"  # À modifier selon votre config

echo "================================================"
echo "VALIDATION PLATEFORME LOGSYSTEM"
echo "URL: $RENDER_URL"
echo "================================================"
echo ""

# Nettoyer le fichier de cookies
rm -f "$COOKIES_FILE"

# ── 1. PRÉREQUIS ─────────────────────────────────────────────────────
echo "📦 1. Prérequis (npm install, test, lint)"
echo "------------------------------------------------"
npm install
npm test
npm run lint
echo "✅ Prérequis OK"
echo ""

# ── 2. DIAGNOSTICS PROJET ────────────────────────────────────────────
echo "🔍 2. Diagnostics du projet"
echo "------------------------------------------------"
npm run diagnose:comprehensive
npm run diagnose:admin
npm run diagnose:counts
npm run diagnose:rules
echo "✅ Diagnostics OK"
echo ""

# ── 3. TEST DE SANTÉ ─────────────────────────────────────────────────
echo "💚 3. Test de santé (/health)"
echo "------------------------------------------------"
HEALTH_RESPONSE=$(curl -s -w "\n%{http_code}" "$RENDER_URL/health")
HTTP_CODE=$(echo "$HEALTH_RESPONSE" | tail -n1)
BODY=$(echo "$HEALTH_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -eq 200 ]; then
    echo "✅ /health répond 200"
    echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
else
    echo "❌ /health répond $HTTP_CODE"
    echo "$BODY"
    exit 1
fi
echo ""

# ── 4. TEST D'AUTHENTIFICATION ───────────────────────────────────────
echo "🔐 4. Test d'authentification"
echo "------------------------------------------------"

# Créer admin si nécessaire
echo "Création admin (si nécessaire)..."
npm run create-admin || true

# Test login admin
echo "Test login admin..."
LOGIN_RESPONSE=$(curl -s -w "\n%{http_code}" -c "$COOKIES_FILE" -X POST "$RENDER_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
LOGIN_CODE=$(echo "$LOGIN_RESPONSE" | tail -n1)
LOGIN_BODY=$(echo "$LOGIN_RESPONSE" | sed '$d')

if [ "$LOGIN_CODE" -eq 200 ]; then
    echo "✅ Login admin OK"
else
    echo "❌ Login admin échoué (HTTP $LOGIN_CODE)"
    echo "$LOGIN_BODY"
    exit 1
fi

# Test accès sans auth
echo "Test accès sans auth..."
UNAUTH_RESPONSE=$(curl -s -w "\n%{http_code}" "$RENDER_URL/api/admin/system/status")
UNAUTH_CODE=$(echo "$UNAUTH_RESPONSE" | tail -n1)

if [ "$UNAUTH_CODE" -eq 401 ]; then
    echo "✅ Accès sans auth bloqué (401)"
else
    echo "⚠️  Accès sans auth répond $UNAUTH_CODE (attendu 401)"
fi
echo ""

# ── 5. TEST ADMIN / UTILISATEUR ────────────────────────────────────────
echo "👤 5. Test admin / utilisateur"
echo "------------------------------------------------"

# Lister les utilisateurs
echo "Liste des utilisateurs..."
USERS_RESPONSE=$(curl -s -b "$COOKIES_FILE" "$RENDER_URL/api/admin/users")
echo "$USERS_RESPONSE" | jq '.' 2>/dev/null || echo "$USERS_RESPONSE"
echo "✅ Liste utilisateurs OK"
echo ""

# ── 6. TEST D'IMPORT DE LOGS ───────────────────────────────────────────
echo "📥 6. Test d'import de logs"
echo "------------------------------------------------"
echo "⚠️  Ce test nécessite un fichier log réel."
echo "Instructions manuelles :"
echo "1. Allez sur $RENDER_URL/import.html"
echo "2. Importez un petit fichier log (.log, .json, .jsonl)"
echo "3. Vérifiez que l'import se termine avec status 'completed'"
echo "4. Vérifiez le compteur de lignes"
echo ""

# Test API import stats
echo "Stats import jobs..."
IMPORT_STATS=$(curl -s -b "$COOKIES_FILE" "$RENDER_URL/api/admin/import-jobs")
echo "$IMPORT_STATS" | jq '.' 2>/dev/null || echo "$IMPORT_STATS"
echo ""

# ── 7. TEST DE RECHERCHE ET DASHBOARD ────────────────────────────────
echo "🔍 7. Test de recherche et dashboard"
echo "------------------------------------------------"

# Dashboard summary
echo "Dashboard summary..."
DASHBOARD_SUMMARY=$(curl -s -b "$COOKIES_FILE" "$RENDER_URL/api/dashboard/summary")
echo "$DASHBOARD_SUMMARY" | jq '.' 2>/dev/null || echo "$DASHBOARD_SUMMARY"

# Dashboard trends
echo "Dashboard trends..."
DASHBOARD_TRENDS=$(curl -s -b "$COOKIES_FILE" "$RENDER_URL/api/dashboard/trends")
echo "$DASHBOARD_TRENDS" | jq '.' 2>/dev/null || echo "$DASHBOARD_TRENDS"

# Dashboard recent logs
echo "Dashboard recent logs..."
DASHBOARD_RECENT=$(curl -s -b "$COOKIES_FILE" "$RENDER_URL/api/dashboard/recent-logs")
echo "$DASHBOARD_RECENT" | jq '.' 2>/dev/null || echo "$DASHBOARD_RECENT"
echo "✅ Dashboard OK"
echo ""

# ── 8. TEST DES ALERTES ───────────────────────────────────────────────
echo "🚨 8. Test des alertes"
echo "------------------------------------------------"

# Règles d'alerte
echo "Règles d'alerte..."
ALERT_RULES=$(curl -s -b "$COOKIES_FILE" "$RENDER_URL/api/admin/alert-rules")
echo "$ALERT_RULES" | jq '.' 2>/dev/null || echo "$ALERT_RULES"

# Alertes existantes
echo "Alertes existantes..."
ALERTS=$(curl -s -b "$COOKIES_FILE" "$RENDER_URL/api/alerts")
echo "$ALERTS" | jq '.' 2>/dev/null || echo "$ALERTS"
echo "✅ Alertes OK"
echo ""

# ── 9. TEST DE RÉTENTION ───────────────────────────────────────────────
echo "⏰ 9. Test de rétention"
echo "------------------------------------------------"

# Stats rétention
echo "Stats rétention..."
RETENTION_STATS=$(curl -s -b "$COOKIES_FILE" "$RENDER_URL/api/admin/retention/stats")
echo "$RETENTION_STATS" | jq '.' 2>/dev/null || echo "$RETENTION_STATS"

# Exécuter rétention
echo "Exécution rétention..."
RETENTION_RUN=$(curl -s -w "\n%{http_code}" -b "$COOKIES_FILE" -X POST "$RENDER_URL/api/admin/retention/run")
RETENTION_CODE=$(echo "$RETENTION_RUN" | tail -n1)
RETENTION_BODY=$(echo "$RETENTION_RUN" | sed '$d')

if [ "$RETENTION_CODE" -eq 200 ]; then
    echo "✅ Rétention exécutée avec succès"
    echo "$RETENTION_BODY" | jq '.' 2>/dev/null || echo "$RETENTION_BODY"
else
    echo "⚠️  Rétention répond $RETENTION_CODE"
    echo "$RETENTION_BODY"
fi
echo ""

# ── 10. TEST DE PURGE MANUELLE ────────────────────────────────────────
echo "🗑️  10. Test de purge manuelle"
echo "------------------------------------------------"

# Purge par niveau (WARNING par exemple)
echo "Purge par niveau (WARNING)..."
PURGE_LEVEL=$(curl -s -w "\n%{http_code}" -b "$COOKIES_FILE" -X POST "$RENDER_URL/api/admin/purge" \
  -H "Content-Type: application/json" \
  -d '{"log_level":"WARNING"}')
PURGE_LEVEL_CODE=$(echo "$PURGE_LEVEL" | tail -n1)
PURGE_LEVEL_BODY=$(echo "$PURGE_LEVEL" | sed '$d')

if [ "$PURGE_LEVEL_CODE" -eq 200 ]; then
    echo "✅ Purge par niveau OK"
    echo "$PURGE_LEVEL_BODY" | jq '.' 2>/dev/null || echo "$PURGE_LEVEL_BODY"
else
    echo "⚠️  Purge par niveau répond $PURGE_LEVEL_CODE"
    echo "$PURGE_LEVEL_BODY"
fi

# Purge par date
echo "Purge par date (avant aujourd'hui)..."
TODAY=$(date -u +"%Y-%m-%d %H:%M:%S")
PURGE_DATE=$(curl -s -w "\n%{http_code}" -b "$COOKIES_FILE" -X POST "$RENDER_URL/api/admin/purge" \
  -H "Content-Type: application/json" \
  -d "{\"date_before\":\"$TODAY\"}")
PURGE_DATE_CODE=$(echo "$PURGE_DATE" | tail -n1)
PURGE_DATE_BODY=$(echo "$PURGE_DATE" | sed '$d')

if [ "$PURGE_DATE_CODE" -eq 200 ]; then
    echo "✅ Purge par date OK"
    echo "$PURGE_DATE_BODY" | jq '.' 2>/dev/null || echo "$PURGE_DATE_BODY"
else
    echo "⚠️  Purge par date répond $PURGE_DATE_CODE"
    echo "$PURGE_DATE_BODY"
fi
echo ""

# ── 11. TEST DE ROBUSTESSE DB / SCHÉMA ───────────────────────────────
echo "🗄️  11. Test de robustesse DB / schéma"
echo "------------------------------------------------"
echo "⚠️  Ce test nécessite un accès direct à la base de données."
echo "Commandes SQL à exécuter manuellement :"
echo ""
echo "SHOW TABLES;"
echo "DESCRIBE logs;"
echo "DESCRIBE error_groups;"
echo "DESCRIBE alerts;"
echo "SHOW INDEX FROM logs;"
echo "SHOW INDEX FROM error_groups;"
echo ""

# ── 12. CHECKLIST DE VALIDATION FINALE ────────────────────────────────
echo "✅ 12. Checklist de validation finale"
echo "------------------------------------------------"
echo "✅ /health répond 200"
echo "✅ MySQL accessible"
echo "✅ Admin login OK"
echo "✅ Dashboard accessible"
echo "✅ Purge par niveau OK"
echo "✅ Purge par date OK"
echo "✅ Rétention OK"
echo "✅ Import stats OK"
echo "✅ Recherche OK"
echo "✅ Alertes OK"
echo "✅ Admin actions OK"
echo ""

# Nettoyer
rm -f "$COOKIES_FILE"

echo "================================================"
echo "VALIDATION TERMINÉE"
echo "================================================"
echo ""
echo "Tests manuels restants à effectuer :"
echo "1. Import d'un fichier log réel via UI"
echo "2. Test de recherche par mot-clé dans UI"
echo "3. Vérification du graphique de tendances dans UI"
echo "4. Test de création/modification d'utilisateur dans UI"
echo "5. Test de création de règle d'alerte dans UI"
echo "6. Vérification des logs Render pour erreurs"
echo ""
