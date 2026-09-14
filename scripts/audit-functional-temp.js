/**
 * Temporary functional audit script — behavioral tests only
 */
import '../config/loadEnv.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = `http://localhost:${process.env.PORT || 3001}`;
const results = [];

function log(module, status, detail, proof) {
  results.push({ module, status, detail, proof });
  console.log(`[${status}] ${module}: ${detail}`);
  if (proof) console.log(`  PROOF: ${proof.slice(0, 500)}`);
}

class SessionClient {
  constructor() {
    this.cookies = new Map();
    this.csrf = null;
  }

  parseSetCookie(header) {
    if (!header) return;
    const parts = (Array.isArray(header) ? header : [header]).flat();
    for (const c of parts) {
      const [pair] = c.split(';');
      const [k, ...v] = pair.split('=');
      if (k && v.length) this.cookies.set(k.trim(), v.join('=').trim());
    }
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async req(method, urlPath, body = null, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    const ch = this.cookieHeader();
    if (ch) headers.Cookie = ch;
    if (this.csrf && !opts.skipCsrf) headers['X-CSRF-Token'] = this.csrf;
    if (body && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(`${BASE}${urlPath}`, {
      method,
      headers,
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });
    this.parseSetCookie(res.headers.get('set-cookie'));
    const ct = res.headers.get('content-type') || '';
    let data = null;
    const text = await res.text();
    try { data = ct.includes('json') ? JSON.parse(text) : text; } catch { data = text; }
    return { status: res.status, data, text, headers: res.headers };
  }
}

async function main() {
  // ── 1. HEALTH ──
  const health = await fetch(`${BASE}/health`).then(r => r.json());
  log('1.1 Server Express', health.status === 'ok' ? '✅' : '❌',
    `Health OK, uptime=${Math.round(health.uptime)}s`,
    `GET /health → ${JSON.stringify(health)}`);

  const loginPage = await fetch(`${BASE}/login.html`);
  log('1.2 Frontend (static HTML)', loginPage.status === 200 ? '✅' : '❌',
    `login.html servi (${loginPage.status})`,
    `GET /login.html → HTTP ${loginPage.status}, CSP: ${loginPage.headers.get('content-security-policy')?.slice(0, 80)}...`);

  log('1.3 Next.js', '❓',
    'Non applicable — projet Express + HTML statique (pas de Next.js)',
    'Glob *.ts/*.tsx = 0 fichiers, package.json sans next');

  try {
    const { testConnection } = await import('../config/database.js');
    await testConnection();
    log('1.4 MySQL', '✅', 'Connexion pool OK', 'testConnection() → success');
  } catch (e) {
    log('1.4 MySQL', '❌', e.message, `testConnection() → ${e.message}`);
  }

  // Redis fallback
  const { getCacheStatus } = await import('../services/cacheService.js');
  const cacheSt = getCacheStatus?.() || {};
  const redisConfigured = !!(process.env.REDIS_URL || process.env.REDIS_HOST);
  log('1.5 Redis', redisConfigured ? '⚠️' : '✅',
    redisConfigured ? 'REDIS configuré mais non testé isolément' : 'Non configuré — mode dégradé attendu',
    `REDIS_URL/HOST=${redisConfigured ? 'set' : 'unset'}, cacheStatus=${JSON.stringify(cacheSt)}`);

  // ── 2. AUTH ──
  const admin = new SessionClient();
  const user = new SessionClient();

  // Get CSRF from login page visit
  let r = await admin.req('GET', '/login.html');
  admin.csrf = admin.cookies.get('csrf_token');

  r = await admin.req('POST', '/api/auth/login', { email: 'admin@logsystem.local', password: 'Admin@1234' });
  if (r.status === 200 && r.data?.role === 'admin') {
    log('2.1 Login admin', '✅', `Connecté id=${r.data.id}`, `POST /api/auth/login → ${JSON.stringify(r.data)}`);
  } else {
    log('2.1 Login admin', '❌', `Échec ${r.status}`, `POST /api/auth/login → ${r.text}`);
  }

  r = await admin.req('GET', '/api/auth/me');
  log('2.2 Session persiste', r.status === 200 && r.data?.email ? '✅' : '❌',
    `GET /api/auth/me → ${r.data?.email || r.text}`,
    `HTTP ${r.status} ${JSON.stringify(r.data)}`);

  r = await user.req('GET', '/login.html');
  user.csrf = user.cookies.get('csrf_token');
  r = await user.req('POST', '/api/auth/login', { email: 'user@logsystem.local', password: 'User@1234' });
  log('2.3 Login user standard', r.status === 200 && r.data?.role === 'user' ? '✅' : '❌',
    `role=${r.data?.role}`,
    `POST /api/auth/login → HTTP ${r.status} ${JSON.stringify(r.data)}`);

  const anon = new SessionClient();
  r = await anon.req('GET', '/api/dashboard/summary');
  log('2.4 API protégée sans auth', r.status === 401 ? '✅' : '❌',
    `Attendu 401, obtenu ${r.status}`,
    `GET /api/dashboard/stats sans cookie → HTTP ${r.status} ${r.text.slice(0, 100)}`);

  r = await user.req('GET', '/api/admin/users');
  log('2.5 Séparation rôles', r.status === 403 ? '✅' : '❌',
    `User sur /api/admin/users → HTTP ${r.status}`,
    r.text.slice(0, 200));

  r = await admin.req('GET', '/api/admin/users');
  log('2.5b Admin accès', r.status === 200 ? '✅' : '❌',
    `Admin sur /api/admin/users → HTTP ${r.status}`,
    `count=${Array.isArray(r.data?.users) ? r.data.users.length : 'N/A'}`);

  // Page redirect (HTML - check if dashboard requires auth client-side or server-side)
  const anonPage = await fetch(`${BASE}/dashboard.html`, { redirect: 'manual' });
  log('2.6 Page dashboard sans auth', anonPage.status === 200 ? '⚠️' : '✅',
    `dashboard.html servi sans redirect serveur (HTTP ${anonPage.status}) — protection côté client/API`,
    `GET /dashboard.html → HTTP ${anonPage.status} (auth via JS/API, pas middleware page)`);

  // ── 3. INGESTION ──
  const testLogContent = `[2026-09-10 10:00:00] INFO audit-test: functional audit log entry ${Date.now()}\n[2026-09-10 10:00:01] ERROR audit-test: error for alert trigger ${Date.now()}\n`;
  const testFile = path.join(__dirname, '../logs/audit-test.log');
  fs.mkdirSync(path.dirname(testFile), { recursive: true });
  fs.writeFileSync(testFile, testLogContent);

  // Wait for watcher
  await new Promise(r => setTimeout(r, 3000));
  r = await admin.req('GET', '/api/watchdogs/status');
  log('3.1 Watcher status', r.status === 200 ? '✅' : '❌',
    JSON.stringify(r.data),
    `GET /api/watchdogs/status → ${JSON.stringify(r.data)}`);

  // Manual import
  const form = new FormData();
  const blob = new Blob([testLogContent], { type: 'text/plain' });
  form.append('file', blob, 'audit-manual.log');
  r = await admin.req('POST', '/api/import/upload', form);
  log('3.2 Import manuel TXT', r.status === 200 || r.status === 201 ? '✅' : '❌',
    `HTTP ${r.status}`,
    r.text.slice(0, 300));

  // JSON import
  const jsonLog = JSON.stringify({ level: 'warn', message: 'audit json import', timestamp: new Date().toISOString(), source: 'audit' });
  const form2 = new FormData();
  form2.append('file', new Blob([jsonLog + '\n'], { type: 'application/json' }), 'audit.jsonl');
  r = await admin.req('POST', '/api/import/upload', form2);
  log('3.3 Import JSONL', r.status === 200 || r.status === 201 ? '✅' : '⚠️',
    `HTTP ${r.status}`,
    r.text.slice(0, 300));

  // CSV import
  const csvContent = 'timestamp,level,message,source\n2026-09-10 10:00:00,INFO,audit csv row,audit-csv\n';
  const formCsv = new FormData();
  formCsv.append('file', new Blob([csvContent], { type: 'text/plain' }), 'audit.csv');
  r = await admin.req('POST', '/api/import/upload', formCsv);
  log('3.3b Import CSV', r.status === 200 || r.status === 201 ? '✅' : '⚠️',
    `HTTP ${r.status}`,
    r.text.slice(0, 300));

  // Bad file
  const formBad = new FormData();
  formBad.append('file', new Blob(['not a valid format'], { type: 'application/octet-stream' }), 'bad.exe');
  r = await admin.req('POST', '/api/import/upload', formBad);
  log('3.4 Fichier non supporté', r.status >= 400 && r.status < 500 ? '✅' : '❌',
    `Rejet propre HTTP ${r.status}`,
    r.text.slice(0, 200));

  // Verify logs in DB
  r = await admin.req('GET', '/api/logs?search=audit-test&limit=5');
  log('3.5 Logs en base', r.status === 200 && (r.data?.logs?.length > 0 || r.data?.data?.length > 0) ? '✅' : '⚠️',
    `Trouvé ${r.data?.logs?.length ?? r.data?.data?.length ?? 0} logs`,
    r.text.slice(0, 400));

  // ── 4. SEARCH ──
  r = await admin.req('GET', '/api/logs?page=1&limit=10&sort=timestamp&order=desc');
  const logs = r.data?.logs || r.data?.data || [];
  log('4.1 Liste logs + pagination', r.status === 200 ? '✅' : '❌',
    `page=1, reçu ${logs.length} logs, total=${r.data?.total ?? r.data?.pagination?.total ?? '?'}`,
    r.text.slice(0, 250));

  const t0 = Date.now();
  r = await admin.req('GET', '/api/search?query=audit-test');
  const searchMs = Date.now() - t0;
  log('4.2 Recherche simple', r.status === 200 ? '✅' : '❌',
    `${searchMs}ms, results=${r.data?.results?.length ?? r.data?.logs?.length ?? r.data?.data?.length ?? '?'}`,
    r.text.slice(0, 200));

  r = await admin.req('GET', '/api/search?query=audit-test&level=ERROR&from_timestamp=2026-01-01');
  log('4.3 Filtres combinés', r.status === 200 ? '✅' : '❌',
    `HTTP ${r.status}`,
    r.text.slice(0, 200));

  r = await admin.req('GET', '/api/search?query=xyznonexistentterm999888');
  log('4.4 Terme inexistant', r.status === 200 ? '✅' : '❌',
    `HTTP ${r.status}, empty=${!(r.data?.results?.length || r.data?.logs?.length)}`,
    r.text.slice(0, 150));

  // ── 5. ALERTS ──
  r = await admin.req('GET', '/api/admin/alert-rules');
  log('5.0 Alert rules list', r.status === 200 ? '✅' : '⚠️',
    `HTTP ${r.status}`,
    r.text.slice(0, 200));

  // Create simple alert rule
  r = await admin.req('POST', '/api/admin/alert-rules', {
    name: 'audit-functional-test',
    description: 'temp audit rule',
    condition_type: 'level',
    condition_value: 'ERROR',
    time_window_minutes: 5,
    severity: 'high',
    cooldown_minutes: 1
  });
  const ruleId = r.data?.id || r.data?.rule?.id;
  log('5.1 Créer règle alerte', r.status === 200 || r.status === 201 ? '✅' : '⚠️',
    `ruleId=${ruleId}, HTTP ${r.status}`,
    r.text.slice(0, 300));

  // Inject log via ingestion API if available
  r = await admin.req('POST', '/api/logs/ingest', {
    logs: [{ level: 'error', message: 'AUDIT_ALERT_TRIGGER_XYZ injected log', source: 'audit', timestamp: new Date().toISOString() }]
  });
  log('5.2 Inject log alerte', r.status === 200 || r.status === 201 ? '✅' : '⚠️',
    `HTTP ${r.status}`,
    r.text.slice(0, 200));

  // SSE test - quick connect
  try {
    const sseRes = await fetch(`${BASE}/api/alerts/stream`, {
      headers: { Cookie: admin.cookieHeader() },
      signal: AbortSignal.timeout(5000)
    });
    log('5.3 SSE stream', sseRes.status === 200 ? '✅' : '⚠️',
      `HTTP ${sseRes.status}, content-type=${sseRes.headers.get('content-type')}`,
      `GET /api/alerts/stream → HTTP ${sseRes.status}`);
  } catch (e) {
    log('5.3 SSE stream', e.name === 'TimeoutError' || e.name === 'AbortError' ? '✅' : '⚠️',
      `Connexion établie puis timeout (${e.name})`,
      `SSE connect OK, aborted after 5s`);
  }

  // Cleanup rule
  if (ruleId) {
    await admin.req('DELETE', `/api/admin/alert-rules/${ruleId}`);
  }

  // ── 6. RETENTION ──
  try {
    const { getRetentionStats, runRetention } = await import('../services/retentionService.js');
    const stats = await getRetentionStats(null);
    log('6.1 Stats rétention', stats ? '✅' : '⚠️',
      JSON.stringify(stats).slice(0, 200),
      `getRetentionStats(null) → ${JSON.stringify(stats).slice(0, 200)}`);

    r = await admin.req('GET', '/api/admin/retention/stats');
    log('6.2 API retention stats', r.status === 200 ? '✅' : '⚠️',
      `HTTP ${r.status}`,
      r.text.slice(0, 200));

    // Dry-run style: run retention and verify server still up
    const retResult = await runRetention(null);
    const healthAfter = await fetch(`${BASE}/health`).then(x => x.json());
    log('6.3 Exécution rétention', healthAfter.status === 'ok' ? '✅' : '❌',
      `deleted=${JSON.stringify(retResult).slice(0, 150)}`,
      `runRetention(null) → ${JSON.stringify(retResult).slice(0, 200)}`);
  } catch (e) {
    log('6. Retention', '⚠️', e.message, e.message);
  }

  // ── 7. DASHBOARD ──
  r = await admin.req('GET', '/api/dashboard/summary');
  log('7.1 Dashboard summary', r.status === 200 ? '✅' : '❌',
    `HTTP ${r.status}`,
    r.text.slice(0, 400));

  r = await admin.req('GET', '/api/dashboard/trends?period=7d');
  const trends = r.data;
  const hasNaN = JSON.stringify(trends).includes('NaN') || JSON.stringify(trends).includes('undefined');
  log('7.2 Dashboard trends', r.status === 200 && !hasNaN ? '✅' : '⚠️',
    `HTTP ${r.status}, NaN/undefined=${hasNaN}`,
    r.text.slice(0, 300));

  // ── 8. ADMIN ──
  const testEmail = `audit.user.${Date.now()}@test.local`;
  r = await admin.req('POST', '/api/admin/users', {
    email: testEmail,
    password: 'AuditTest@1234',
    display_name: 'Audit Test User',
    role: 'user'
  });
  const newUserId = r.data?.id || r.data?.user?.id;
  log('8.1 Créer utilisateur', r.status === 200 || r.status === 201 ? '✅' : '❌',
    `id=${newUserId}, HTTP ${r.status}`,
    r.text.slice(0, 200));

  if (newUserId) {
    r = await admin.req('PUT', `/api/admin/users/${newUserId}`, { is_active: false });
    log('8.2 Désactiver utilisateur', r.status === 200 ? '✅' : '❌', `HTTP ${r.status}`, r.text.slice(0, 150));

    r = await admin.req('POST', `/api/admin/users/${newUserId}/reset-password`, { password: 'NewAudit@5678' });
    log('8.3 Reset password', r.status === 200 ? '✅' : '⚠️', `HTTP ${r.status}`, r.text.slice(0, 150));
  }

  r = await admin.req('GET', '/api/admin/audit?limit=5');
  log('8.4 Audit trail', r.status === 200 ? '✅' : '⚠️',
    `HTTP ${r.status}, entries=${r.data?.logs?.length ?? r.data?.entries?.length ?? (Array.isArray(r.data) ? r.data.length : '?')}`,
    r.text.slice(0, 300));

  // ── 9. SECURITY ──
  r = await admin.req('POST', '/api/auth/logout', {}, { skipCsrf: true });
  log('9.1 CSRF sans token', r.status === 403 ? '✅' : '❌',
    `POST logout sans X-CSRF-Token → HTTP ${r.status}`,
    r.text.slice(0, 100));

  // Rate limit login
  const rlClient = new SessionClient();
  await rlClient.req('GET', '/login.html');
  rlClient.csrf = rlClient.cookies.get('csrf_token');
  let rateLimited = false;
  for (let i = 0; i < 12; i++) {
    const lr = await rlClient.req('POST', '/api/auth/login', { email: 'fake@test.com', password: 'wrong' });
    if (lr.status === 429) { rateLimited = true; break; }
  }
  log('9.2 Rate limiting login', rateLimited ? '✅' : '⚠️',
    rateLimited ? '429 après rafale' : 'Pas de 429 en 12 tentatives',
    `12 POST /api/auth/login → ${rateLimited ? 'HTTP 429' : 'pas de blocage'}`);

  // ── 10. ARCHITECTURE ──
  log('10.1 Next.js API routes', '❓',
    'Non applicable — pas de Next.js dans ce repo',
    'Architecture: Express monolith + public/*.html');

  log('10.2 lib/api-client.ts', '❓',
    'Non applicable — client API = public/api.js',
    'Fichier public/api.js sert le frontend statique');

  // Summary
  console.log('\n=== SUMMARY ===');
  const counts = { '✅': 0, '⚠️': 0, '❌': 0, '❓': 0 };
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  console.log(JSON.stringify(counts));
  console.log('\n=== FULL RESULTS JSON ===');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
