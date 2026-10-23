#!/usr/bin/env bash
set -u

# Detect OS and set temp directory
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
  TEMP_DIR="${TEMP:-/tmp}"
else
  TEMP_DIR="/tmp"
fi

BASE_URL="${BASE_URL:-http://localhost:10000}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@logsystem.local}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Admin@1234}"

echo "=== SMOKE TEST LOGSYSTEM ==="
echo "URL: ${BASE_URL}"
echo

curl -fsS "${BASE_URL}/health" > "${TEMP_DIR}/logsystem_health.json" || {
  echo "❌ Health endpoint failed"
  exit 1
}

echo "1. Test /health endpoint..."
curl -sS -o "${TEMP_DIR}/logsystem_health.json" -w "%{http_code}" "${BASE_URL}/health" | grep -q "200" || {
  echo "❌ Health endpoint not returning 200"
  exit 1
}
echo "✅ Health endpoint OK"

echo
echo "2. Test login admin..."
COOKIE_JAR=$(mktemp)
LOGIN_CODE=$(curl -sS -o "${TEMP_DIR}/logsystem_login.json" -w "%{http_code}" \
  -c "$COOKIE_JAR" \
  -H "Content-Type: application/json" \
  -X POST "${BASE_URL}/api/auth/login" \
  -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}")

if [ "$LOGIN_CODE" != "200" ] && [ "$LOGIN_CODE" != "204" ]; then
  echo "❌ Login failed (HTTP ${LOGIN_CODE})"
  cat "${TEMP_DIR}/logsystem_login.json"
  rm -f "$COOKIE_JAR"
  exit 1
fi
echo "✅ Login admin OK"

echo
echo "3. Test /api/admin/system/status..."
STATUS_CODE=$(curl -sS -o "${TEMP_DIR}/logsystem_status.json" -w "%{http_code}" \
  -b "$COOKIE_JAR" \
  "${BASE_URL}/api/admin/system/status")

if [ "$STATUS_CODE" != "200" ]; then
  echo "❌ Admin status failed (HTTP ${STATUS_CODE})"
  cat "${TEMP_DIR}/logsystem_status.json"
  rm -f "$COOKIE_JAR"
  exit 1
fi
echo "✅ Admin status OK"

echo
echo "4. Test /api/admin/users..."
USERS_CODE=$(curl -sS -o "${TEMP_DIR}/logsystem_users.json" -w "%{http_code}" \
  -b "$COOKIE_JAR" \
  "${BASE_URL}/api/admin/users")

if [ "$USERS_CODE" != "200" ]; then
  echo "❌ Users list failed (HTTP ${USERS_CODE})"
  cat "${TEMP_DIR}/logsystem_users.json"
  rm -f "$COOKIE_JAR"
  exit 1
fi
echo "✅ Users list OK"

echo
echo "5. Test /api/admin/retention/stats..."
RETENTION_CODE=$(curl -sS -o "${TEMP_DIR}/logsystem_retention.json" -w "%{http_code}" \
  -b "$COOKIE_JAR" \
  "${BASE_URL}/api/admin/retention/stats")

if [ "$RETENTION_CODE" != "200" ]; then
  echo "❌ Retention stats failed (HTTP ${RETENTION_CODE})"
  cat "${TEMP_DIR}/logsystem_retention.json"
  rm -f "$COOKIE_JAR"
  exit 1
fi
echo "✅ Retention stats OK"

echo
echo "6. Test /api/search..."
SEARCH_CODE=$(curl -sS -o "${TEMP_DIR}/logsystem_search.json" -w "%{http_code}" \
  -b "$COOKIE_JAR" \
  "${BASE_URL}/api/search?q=ERROR")

if [ "$SEARCH_CODE" != "200" ]; then
  echo "❌ Search failed (HTTP ${SEARCH_CODE})"
  cat "${TEMP_DIR}/logsystem_search.json"
  rm -f "$COOKIE_JAR"
  exit 1
fi
echo "✅ Search OK"

# Cleanup
rm -f "$COOKIE_JAR"
rm -f "${TEMP_DIR}/logsystem_"*.json

echo
echo "=== SMOKE TEST TERMINÉ ==="
echo "✅ Tests critiques passés"
