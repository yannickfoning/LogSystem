#!/bin/bash
# Smoke test minimal pour la plateforme LogSystem
# Tests non-destructifs basiques

set -e

BASE_URL="${BASE_URL:-http://localhost:10000}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@logsystem.local}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Admin@1234}"
COOKIE_FILE="cookies.txt"

echo "=== SMOKE TEST LOGSYSTEM ==="
echo "URL: $BASE_URL"
echo ""

# Test 1: Health
echo "1. Test /health endpoint..."
response=$(curl -s -w '\n%{http_code}' "$BASE_URL/health")
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "200" ]; then
    echo "✅ Health endpoint OK (HTTP 200)"
    echo "   Réponse: $(echo "$body" | head -c 100)..."
else
    echo "❌ Health endpoint FAILED (HTTP $http_code)"
    exit 1
fi

# Test 2: Login
echo ""
echo "2. Test login admin..."
login_body="{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}"
response=$(curl -s -w '\n%{http_code}' -c "$COOKIE_FILE" -X POST \
    -H "Content-Type: application/json" \
    -d "$login_body" \
    "$BASE_URL/api/auth/login")

http_code=$(echo "$response" | tail -n1)

if [ "$http_code" = "200" ]; then
    echo "✅ Login admin OK (HTTP 200)"
else
    echo "❌ Login admin FAILED (HTTP $http_code)"
    echo "   Vérifiez: npm run create-admin"
    rm -f "$COOKIE_FILE"
    exit 1
fi

# Test 3: Admin status
echo ""
echo "3. Test /api/admin/system/status..."
response=$(curl -s -w '\n%{http_code}' -b "$COOKIE_FILE" "$BASE_URL/api/admin/system/status")
http_code=$(echo "$response" | tail -n1)

if [ "$http_code" = "200" ]; then
    echo "✅ Admin status OK (HTTP 200)"
else
    echo "⚠️  Admin status returned HTTP $http_code"
fi

# Test 4: Users list
echo ""
echo "4. Test /api/admin/users..."
response=$(curl -s -w '\n%{http_code}' -b "$COOKIE_FILE" "$BASE_URL/api/admin/users")
http_code=$(echo "$response" | tail -n1)

if [ "$http_code" = "200" ]; then
    echo "✅ Users list OK (HTTP 200)"
else
    echo "⚠️  Users list returned HTTP $http_code"
fi

# Test 5: Retention stats
echo ""
echo "5. Test /api/admin/retention/stats..."
response=$(curl -s -w '\n%{http_code}' -b "$COOKIE_FILE" "$BASE_URL/api/admin/retention/stats")
http_code=$(echo "$response" | tail -n1)

if [ "$http_code" = "200" ]; then
    echo "✅ Retention stats OK (HTTP 200)"
else
    echo "⚠️  Retention stats returned HTTP $http_code"
fi

# Test 6: Search
echo ""
echo "6. Test /api/search..."
response=$(curl -s -w '\n%{http_code}' -b "$COOKIE_FILE" "$BASE_URL/api/search?q=ERROR&limit=10")
http_code=$(echo "$response" | tail -n1)

if [ "$http_code" = "200" ]; then
    echo "✅ Search OK (HTTP 200)"
else
    echo "⚠️  Search returned HTTP $http_code"
fi

# Cleanup
rm -f "$COOKIE_FILE"

echo ""
echo "=== SMOKE TEST TERMINÉ ==="
echo "✅ Tests critiques passés"
