#!/usr/bin/env bash
set -u

BASE_URL="${BASE_URL:-http://localhost:10000}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@logsystem.local}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Admin@1234}"

TMPDIR="${TMPDIR:-/tmp}"
COOKIE_JAR="$(mktemp "${TMPDIR%/}/logsystem-smoke-XXXXXX.cookie")"
HEALTH_FILE="$(mktemp "${TMPDIR%/}/logsystem-health-XXXXXX.json")"
LOGIN_FILE="$(mktemp "${TMPDIR%/}/logsystem-login-XXXXXX.json")"
STATUS_FILE="$(mktemp "${TMPDIR%/}/logsystem-status-XXXXXX.json")"
USERS_FILE="$(mktemp "${TMPDIR%/}/logsystem-users-XXXXXX.json")"
RETENTION_FILE="$(mktemp "${TMPDIR%/}/logsystem-retention-XXXXXX.json")"
SEARCH_FILE="$(mktemp "${TMPDIR%/}/logsystem-search-XXXXXX.json")"

cleanup() {
  rm -f "$COOKIE_JAR" "$HEALTH_FILE" "$LOGIN_FILE" "$STATUS_FILE" "$USERS_FILE" "$RETENTION_FILE" "$SEARCH_FILE"
}
trap cleanup EXIT

echo "=== SMOKE TEST LOGSYSTEM ==="
echo "URL: ${BASE_URL}"
echo

echo "1. Test /health endpoint..."
HTTP_CODE=$(curl -sS -o "$HEALTH_FILE" -w "%{http_code}" "${BASE_URL}/health")
if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ Health endpoint failed (HTTP $HTTP_CODE)"
  cat "$HEALTH_FILE"
  exit 1
fi
echo "✅ Health endpoint OK"

echo
echo "2. Test login admin..."
LOGIN_CODE=$(curl -sS -o "$LOGIN_FILE" -w "%{http_code}" \
  -c "$COOKIE_JAR" \
  -H "Content-Type: application/json" \
  -X POST "${BASE_URL}/api/auth/login" \
  -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}")

if [ "$LOGIN_CODE" != "200" ] && [ "$LOGIN_CODE" != "204" ]; then
  echo "❌ Login failed (HTTP $LOGIN_CODE)"
  cat "$LOGIN_FILE"
  exit 1
fi
echo "✅ Login admin OK"

echo
echo "3. Test /api/admin/system/status..."
STATUS_CODE=$(curl -sS -o "$STATUS_FILE" -w "%{http_code}" \
  -b "$COOKIE_JAR" \
  "${BASE_URL}/api/admin/system/status")

if [ "$STATUS_CODE" != "200" ]; then
  echo "❌ Admin status failed (HTTP $STATUS_CODE)"
  cat "$STATUS_FILE"
  exit 1
fi
echo "✅ Admin status OK"

echo
echo "4. Test /api/admin/users..."
USERS_CODE=$(curl -sS -o "$USERS_FILE" -w "%{http_code}" \
  -b "$COOKIE_JAR" \
  "${BASE_URL}/api/admin/users")

if [ "$USERS_CODE" != "200" ]; then
  echo "❌ Users list failed (HTTP $USERS_CODE)"
  cat "$USERS_FILE"
  exit 1
fi
echo "✅ Users list OK"

echo
echo "5. Test /api/admin/retention/stats..."
RETENTION_CODE=$(curl -sS -o "$RETENTION_FILE" -w "%{http_code}" \
  -b "$COOKIE_JAR" \
  "${BASE_URL}/api/admin/retention/stats")

if [ "$RETENTION_CODE" != "200" ]; then
  echo "❌ Retention stats failed (HTTP $RETENTION_CODE)"
  cat "$RETENTION_FILE"
  exit 1
fi
echo "✅ Retention stats OK"

echo
echo "6. Test /api/search..."
SEARCH_CODE=$(curl -sS -o "$SEARCH_FILE" -w "%{http_code}" \
  -b "$COOKIE_JAR" \
  "${BASE_URL}/api/search?q=ERROR")

if [ "$SEARCH_CODE" != "200" ]; then
  echo "❌ Search failed (HTTP $SEARCH_CODE)"
  cat "$SEARCH_FILE"
  exit 1
fi
echo "✅ Search OK"

echo
echo "=== SMOKE TEST TERMINÉ ==="
echo "✅ Tests critiques passés"
