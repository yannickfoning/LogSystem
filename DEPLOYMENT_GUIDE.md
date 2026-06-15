# LogSystem V4 — Deployment & Testing Guide

**Generated:** May 18, 2026  
**Audit Implementation:** Sprint 1-2 Complete

---

## 📦 Pre-Deployment Checklist

### 1. Dependencies Installation

```bash
# Install all dependencies (including newly added compression & redis)
npm install

# Verify installation
npm list compression redis
```

### 2. Database Schema Migration

```bash
# Apply schema updates (new tables, indexes, columns)
node scripts/apply-schema.js

# Verify schema applied
mysql -u $DB_USER -p$DB_PASSWORD $DB_NAME < db/schema.sql
```

### 3. Environment Configuration

Create/update `.env`:

```bash
# Core
NODE_ENV=production
PORT=3000
SESSION_SECRET=<generate-via: node scripts/tools/generate-secret.js>

# Database
DB_HOST=localhost
DB_PORT=3306
DB_USER=loguser
DB_PASSWORD=<secure-password>
DB_NAME=logsystem

# Database Connection Pooling
DB_CONNECTION_LIMIT=10 # Max number of connections in the pool. Adjust based on expected load.
# Optional: Redis for caching (P-09)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=0

# File Upload
UPLOAD_MAX_SIZE=52428800  # 50MB

# Bcrypt
BCRYPT_ROUNDS=12

# Alert Debounce (P-06)
ALERT_DEBOUNCE_MS=2000

# Watch Logs
WATCH_DIR_USER_MAP={"1": "/var/log/myapp"}  # Map user_id → directory path
```

---

## 🧪 Testing Strategy

### Phase 1: Security Testing

#### S-01/S-02: User Isolation & Admin Scope

```bash
# Test 1: Non-admin sees only own data
curl -b cookies.txt \
  http://localhost:3000/api/logs?limit=10

# Test 2: Non-admin ?scope=all is ignored
curl -b cookies.txt \
  http://localhost:3000/api/logs?scope=all&limit=10

# Test 3: Admin with ?scope=all sees global data
curl -b cookies.txt \
  http://localhost:3000/api/logs?scope=all&limit=10

# Expected: Non-admin returns their logs, Admin returns all
```

#### S-04: CSRF Token Validation

```bash
# Test 1: Missing CSRF token → 403
curl -X POST http://localhost:3000/api/auth/logout \
  -H "Content-Type: application/json"

# Test 2: Invalid CSRF token → 403
curl -X POST http://localhost:3000/api/auth/logout \
  -b cookies.txt \
  -H "X-CSRF-Token: invalid_token" \
  -H "Content-Type: application/json"

# Test 3: Valid CSRF token → 200
curl -X POST http://localhost:3000/api/auth/logout \
  -b cookies.txt \
  -H "X-CSRF-Token: <valid-token-from-page>" \
  -H "Content-Type: application/json"
```

#### S-08/S-09: Timing-Safe Authentication

```bash
# Test 1: Non-existent user response time should match failed hash
time curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"nonexistent@example.com","password":"wrong"}'

# Test 2: Existing user with wrong password - response time should be similar
time curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"wrong"}'

# Expected: Times should be within ±100ms (due to bcrypt hashing)
```

### Phase 2: Performance Testing

#### P-01: Bulk Insert Speed

```bash
# Test 1: Import 10k log lines via upload
time curl -F "file=@test-10k.log" \
  http://localhost:3000/api/import/upload

# Expected: < 10 seconds for 10k lines (vs ~300s for sequential)
```

#### P-03: FULLTEXT Search

```bash
# Test 1: Search with MATCH AGAINST (should use index)
time curl -b cookies.txt \
  "http://localhost:3000/api/logs?search=error+database&limit=1000"

# Expected: < 100ms for 10M rows (vs >10s for LIKE '%…%')
```

#### P-04: Keyset Pagination

```bash
# Test 1: First page
curl -b cookies.txt \
  "http://localhost:3000/api/logs?limit=20&sort=DESC" > page1.json

# Test 2: Extract cursor from last ID in page1
CURSOR=$(jq '.data[-1].id' page1.json)

# Test 3: Next page using cursor (no OFFSET)
curl -b cookies.txt \
  "http://localhost:3000/api/logs?limit=20&cursor=$CURSOR&sort=DESC" > page2.json

# Expected: Page load time < 50ms (regardless of page number)
```

#### P-06: Alert Debouncing

```bash
# Test 1: Import logs that trigger rule evaluation multiple times
# Monitor alert eval count during import:
watch -n 1 'tail -f logs/*.log | grep "evalAllForUser"'

# Test 2: Upload 1000 log lines in rapid succession
time for i in {1..10}; do
  curl -F "file=@batch-$i.log" \
    http://localhost:3000/api/import/upload &
done

# Expected: Should see only 1-2 alert evaluations per user (not 10+)
```

#### P-09: Dashboard Cache (30s TTL)

```bash
# Test 1: First request (cache miss)
time curl -b cookies.txt \
  http://localhost:3000/api/dashboard/summary

# Test 2: Immediate second request (cache hit)
time curl -b cookies.txt \
  http://localhost:3000/api/dashboard/summary

# Test 3: After 31 seconds (cache expired)
sleep 31
time curl -b cookies.txt \
  http://localhost:3000/api/dashboard/summary

# Expected: Cache hit ~10-50ms, cache miss ~200-500ms
```

#### P-10: PDF Export Limit

```bash
# Test 1: Request PDF with 10k logs
curl -b cookies.txt \
  "http://localhost:3000/api/logs/export/pdf?limit=10000" \
  > large.pdf

# Verify PDF contains exactly 1000 rows
pdftotext large.pdf - | wc -l

# Expected: PDF is limited to 1000 rows (not 10k)
```

#### P-13: HTTP Compression

```bash
# Test 1: Check compression header
curl -I -b cookies.txt \
  http://localhost:3000/api/logs?limit=1000

# Expected: Content-Encoding: gzip or deflate in response headers
```

### Phase 3: Data Integrity Testing

#### L-03: Format Detection

```bash
# Test JSON import
curl -F "file=@logs.json" \
  http://localhost:3000/api/import/upload

# Test CSV import
curl -F "file=@logs.csv" \
  http://localhost:3000/api/import/upload

# Test XML import
curl -F "file=@logs.xml" \
  http://localhost:3000/api/import/upload

# Test Syslog import
curl -F "file=@syslog.txt" \
  http://localhost:3000/api/import/upload

# Verify all formats are imported correctly
curl -b cookies.txt http://localhost:3000/api/dashboard/summary
```

#### L-04: Fingerprint User Scoping

```sql
-- Verify fingerprints are unique per user+message
SELECT fingerprint, user_id, COUNT(*) as cnt
FROM logs
WHERE normalized_message = 'database connection timeout'
GROUP BY fingerprint, user_id;

-- Should see same message with different fingerprints for different users
```

#### L-06: Timestamp Validation

```bash
# Upload CSV with out-of-range timestamps
# (e.g., year 2000, year 2050)
curl -F "file=@logs-bad-timestamp.csv" \
  http://localhost:3000/api/import/upload

# Query logs to verify timestamps were clamped
curl -b cookies.txt \
  "http://localhost:3000/api/logs?limit=5" | jq '.data[].timestamp'

# Expected: Timestamps should be within [now-10y, now+1d]
```

### Phase 4: Real-Time Testing (Alerts)

#### A-02: Alert TTL Buffer

```bash
# Subscribe to SSE stream
curl -N -H "Last-Event-ID: 0" \
  -b cookies.txt \
  http://localhost:3000/api/alerts/stream &

# Wait 35+ minutes
# Trigger alert
# Reconnect with Last-Event-ID

# Expected: Alert should NOT be replayed (TTL expired after 30 min)
```

#### A-04: Severity Filtering

```bash
# Test 1: Subscribe to all alerts
curl -N \
  -b cookies.txt \
  http://localhost:3000/api/alerts/stream

# Test 2: Subscribe to only high/critical alerts
curl -N \
  -b cookies.txt \
  "http://localhost:3000/api/alerts/stream?min_severity=high"

# Trigger alerts with different severities
# Expected: Second stream should not receive 'low' or 'medium' alerts
```

#### A-06: Alert Status Update

```bash
# Test PATCH endpoint
curl -X PATCH -b cookies.txt \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <token>" \
  -d '{"status":"dismissed"}' \
  http://localhost:3000/api/admin/alerts/123

# Expected: 200 OK, alert status changed to 'dismissed'
```

### Phase 5: Watch Log Testing (W-01, W-02, W-03)

#### W-01: File Mutex (No Race Conditions)

```bash
# Simulate rapid file updates
for i in {1..100}; do
  echo "Log line $i" >> /var/log/myapp/test.log
done

# Check logs are ingested correctly (no duplicates)
curl -b cookies.txt \
  "http://localhost:3000/api/logs?source=test.log&limit=100" | \
  jq '.data | length'

# Expected: 100 unique entries (no duplicates)
```

#### W-02: Offset Persistence

```bash
# 1. Write 100 lines to watched log
echo "Line 1" >> /var/log/myapp/test.log
...
echo "Line 100" >> /var/log/myapp/test.log

# 2. Verify ingestion
curl -b cookies.txt http://localhost:3000/api/dashboard/summary

# 3. Restart server
pm2 restart LogSystem

# 4. Verify no duplicate ingestion
# (check logs table - should still have 100 rows, not 200)
```

#### W-03: Log Rotation Detection

```bash
# 1. Add 100 lines to test.log
for i in {1..100}; do
  echo "Line $i" >> /var/log/myapp/test.log
done

# 2. Rotate the log (mimics logrotate)
mv /var/log/myapp/test.log /var/log/myapp/test.log.1
touch /var/log/myapp/test.log

# 3. Add new lines to rotated file
for i in {101..150}; do
  echo "Line $i" >> /var/log/myapp/test.log
done

# 4. Verify watcher re-ingested rotated file
curl -b cookies.txt http://localhost:3000/api/dashboard/summary

# Expected: 150 total logs (old 100 + new 50)
```

---

## 📊 Load Testing

### Using Apache Bench (ab)

```bash
# Test 1: Dashboard API under load
ab -n 1000 -c 10 -b cookies.txt \
  http://localhost:3000/api/dashboard/summary

# Test 2: Log search under load
ab -n 1000 -c 10 -b cookies.txt \
  "http://localhost:3000/api/logs?search=error&limit=20"

# Expected: Response times < 200ms (p95) with caching
```

### Using k6

```javascript
// test-load.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = {
  stages: [
    { duration: '2m', target: 100 },
    { duration: '5m', target: 100 },
    { duration: '2m', target: 0 },
  ],
};

export default function () {
  let url = 'http://localhost:3000/api/logs?limit=20';
  let res = http.get(url);
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 200ms': (r) => r.timings.duration < 200,
  });
  sleep(1);
}
```

Run:

```bash
k6 run test-load.js
```

---

## 🔍 Debugging Commands

### View Alert Evaluation Logs

```bash
tail -f logs/app.log | grep -i "evalAllForUser"
```

### Monitor Cache Hits/Misses

```bash
tail -f logs/app.log | grep "\[CACHE\]"
```

### Check Watch Log Processing

```bash
tail -f logs/app.log | grep "\[WATCHER\]"
```

### Monitor File Offset Persistence

```bash
mysql -u $DB_USER -p$DB_PASSWORD $DB_NAME \
  -e "SELECT * FROM watch_offsets ORDER BY updated_at DESC LIMIT 10;"
```

### Check Alert Buffer Size

```bash
tail -f logs/app.log | grep "Alert buffer"
```

---

## 🚀 Rollout Strategy

### Stage 1: Staging (Pre-Production)

1. Deploy to staging environment
2. Run all test phases
3. Perform 48-hour soak test
4. Monitor for crashes, memory leaks, error rates

### Stage 2: Canary Release (5% of users)

1. Deploy to 1 production server
2. Monitor error rates, latency, alert metrics
3. Verify no regressions vs previous version
4. Maintain for 24 hours

### Stage 3: Gradual Rollout (25% → 100%)

1. Deploy to 25% of servers
2. Monitor for 24 hours
3. If stable, deploy to 50%
4. If stable, deploy to 100%
5. Total rollout window: 3-5 days

### Rollback Plan

```bash
# If critical issues detected:
git revert <commit-hash>
npm install
node scripts/apply-schema.js  # Revert DB changes if needed
pm2 restart all
```

---

## 📈 Performance Metrics to Monitor

After deployment, establish baseline metrics:

| Metric | Target | Alert Threshold |
| API Response Time (p95) | < 200ms | > 500ms |
| Dashboard Cache Hit Ratio | > 80% | < 50% |
| Alert Evaluation Time | < 500ms/user | > 2s |
| CPU Usage | < 60% | > 80% |
| Memory Usage | < 500MB | > 800MB |
| Error Rate | < 0.1% | > 1% |
| SSE Connection Count | < 1000 | Investigate spike |

---

## 📝 Validation Checklist Before Go-Live

- [ ] All 13 security fixes verified
- [ ] All 12 performance fixes benchmarked
- [ ] All 6 format detection parsers tested
- [ ] Alert debouncing confirmed working
- [ ] Cache invalidation on data mutations
- [ ] Database backups automated
- [ ] SSL/TLS certificates valid
- [ ] Rate limiting configured
- [ ] CSRF tokens validated
- [ ] User scoping verified
- [ ] Watch directory permissions correct
- [ ] Redis connection optional (fallback works)
- [ ] Dependencies updated and audited
- [ ] Error handling tested
- [ ] Load test passed (1000 RPS)

---

## 📞 Support Contacts

**On-Call Engineering:** [contact info]  
**Database Admin:** [contact info]  
**Infrastructure:** [contact info]

---

**Deployment Date:** [To Be Scheduled]  
**Estimated Downtime:** 0 minutes (hot rollout with canary)
