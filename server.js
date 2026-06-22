/* eslint-disable no-unused-vars */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

import crypto from 'crypto';
import logger from './config/logger.js';
import express from 'express';
import session from 'express-session';
import MySQLStore from 'express-mysql-session';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import fs from 'fs';

import { testConnection, buildSslOptions } from './config/database.js';
import { runMigrations } from './lib/database/migrationRunner.js';
import { requireAuth } from './middleware/auth.js';
import { scopeGuard } from './middleware/scopeGuard.js';
import { csrfMiddleware, csrfValidation } from './middleware/csrf.js';
import authRoutes from './routes/auth.js';
import logsRoutes from './routes/logs.js';
import importRoutes, { multerErrorHandler } from './routes/import.js';
import dashboardRoutes from './routes/dashboard.js';
import adminRoutes from './routes/admin.js';
import searchApiRoutes from './routes/api/search.js';
import { alertWorker } from './workers/alertWorker.js';
import { startAlertEngine, setAlertWorker, stopAlertEngine } from './services/alertEngine.js';
import { startRetentionScheduler } from './services/retentionService.js';
import { startWatcher, stopWatcher, getWatcherStatus } from './services/watcherService.js';
import { startCacheService } from './services/cacheService.js';
import { createHtmlCspMiddleware } from './middleware/htmlCsp.js';

// ── Detect environment ────────────────────────────────────────────────────────
const IS_VERCEL = !!(process.env.VERCEL || process.env.VERCEL_ENV || process.env.NOW_REGION);
const IS_PROD = process.env.NODE_ENV === 'production';

// ── Anti-crash global (non-Vercel only) ──────────────────────────────────────
if (!IS_VERCEL) {
  process.on('uncaughtException', (err) => {
    logger.error({ event: 'uncaughtException', message: err.message, stack: err.stack });
    process.exit(1);
  });
}
process.on('unhandledRejection', (reason) => {
  logger.error({ event: 'unhandledRejection', message: reason?.message || String(reason) });
});

// ── Express app (built synchronously — Vercel needs this ready at module load) ─
const app = express();
app.set('trust proxy', 1);
const PORT = parseInt(process.env.PORT || '3001', 10);

// ── HTTPS redirect ────────────────────────────────────────────────────────────
if (IS_PROD) {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

// ── Session secret ────────────────────────────────────────────────────────────
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.length < 32) {
  logger.warn('[WARN] SESSION_SECRET missing or too short — using insecure fallback. Set SESSION_SECRET in Vercel env vars!');
}
const effectiveSecret = sessionSecret || ('logsystem-insecure-' + crypto.randomBytes(16).toString('hex'));

// ── Middleware ────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

app.use(compression({
  filter: (req, res) => {
    if (req.path.endsWith('/stream') || req.headers.accept === 'text/event-stream') return false;
    return compression.filter(req, res);
  }
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

app.use((req, res, next) => {
  helmet({
    hsts: IS_PROD ? { maxAge: 31536000, includeSubDomains: true } : false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", `'nonce-${res.locals.cspNonce}'`, "https://cdnjs.cloudflare.com", "https://unpkg.com"],
        styleSrc: ["'self'", `'nonce-${res.locals.cspNonce}'`, "https://cdnjs.cloudflare.com", "'unsafe-inline'"],
        styleSrcAttr: ["'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'", "data:"],
        frameSrc: ["'none'"],
      }
    },
    crossOriginEmbedderPolicy: false
  })(req, res, next);
});

// Adjust rate limits for Vercel serverless environment
const isVercel = !!(process.env.VERCEL || process.env.VERCEL_ENV);
const globalMax = isVercel ? 1000 : 500;
const loginMax = isVercel ? 30 : 10;

const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: globalMax, standardHeaders: true, legacyHeaders: false });
app.use(globalLimiter);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: loginMax,
  message: { error: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.' },
  standardHeaders: true, legacyHeaders: false
});

// Add specific rate limiter for alerts/stream to prevent abuse
const alertsStreamLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: isVercel ? 60 : 30, // 60 requests per minute on Vercel, 30 otherwise
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method !== 'GET'
});

// ── Session store (MySQL) ─────────────────────────────────────────────────────
const MySQLSessionStore = MySQLStore(session);
const sslOpts = buildSslOptions();

const sessionStore = new MySQLSessionStore({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_SESSION_CONNECTION_LIMIT || (IS_VERCEL ? '1' : '10'), 10),
  queueLimit: parseInt(process.env.DB_SESSION_QUEUE_LIMIT || (IS_VERCEL ? '25' : '0'), 10),
  ssl: sslOpts || undefined,
  clearExpired: !IS_VERCEL,
  checkExpirationInterval: 900000,
  expiration: 86400000,
  schema: { tableName: 'sessions' }
});

app.use(session({
  secret: effectiveSecret,
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    httpOnly: true,
    secure: IS_PROD,
    maxAge: 86400000,
    sameSite: 'lax'
  }
}));

app.use((req, res, next) => {
  const isSecure = IS_PROD || req.headers['x-forwarded-proto'] === 'https';
  if (req.session && req.session.cookie) req.session.cookie.secure = isSecure;
  next();
});

app.use(csrfMiddleware);
app.use(csrfValidation);

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/logs', requireAuth, scopeGuard, logsRoutes);
app.use('/api/import', requireAuth, scopeGuard, importRoutes);
app.use('/api/dashboard', requireAuth, scopeGuard, dashboardRoutes);
app.use('/api/admin', requireAuth, scopeGuard, adminRoutes);
app.use('/api/search', requireAuth, scopeGuard, searchApiRoutes);

app.get('/api/watchdogs/status', requireAuth, (req, res) => {
  res.json(getWatcherStatus());
});
app.get('/api/alerts/stream', alertsStreamLimiter, requireAuth, (req, res) => {
  if (IS_VERCEL) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.write('retry: 60000\n');
    res.write('event: connected\ndata: {"mode":"polling","reason":"vercel_serverless"}\n\n');
    setTimeout(() => { try { res.end(); } catch (_) {} }, 100);
    return;
  }
  alertWorker.addClient(res, req);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime(), vercel: IS_VERCEL });
});

// ── Static files ──────────────────────────────────────────────────────────────
const publicDir = path.join(__dirname, 'public');
app.use(createHtmlCspMiddleware(publicDir));
app.use(express.static(publicDir, { index: false }));
app.get('/', (req, res) => {
  if (req.session?.user) return res.redirect('/dashboard.html');
  res.redirect('/login.html');
});

// ── Error handlers ────────────────────────────────────────────────────────────
app.use(multerErrorHandler);
app.use((err, req, res, next) => {
  logger.error({ event: 'express_error', message: err.message, path: req.path });
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

// ── Background init (non-blocking) ───────────────────────────────────────────
// Runs AFTER the app is exported so Vercel can handle requests immediately.
// Serverless cold starts skip background work and avoid opening DB connections.
let _initialized = false;

async function initialize() {
  if (_initialized) return;
  _initialized = true;

  if (IS_VERCEL) {
    logger.info({ event: 'background_jobs_disabled', platform: 'vercel' }, '[STARTUP]');
    return;
  }

  try {
    await testConnection();
    logger.info({ event: 'db_connected' }, '[DB] Connected');
  } catch (e) {
    logger.error({ event: 'db_connection_failed', error: e.message }, '[DB] Connection failed — check env vars');
    return; // Don't run migrations if DB unreachable
  }

  await runMigrations().catch(e => logger.error({ event: 'migration_failed', error: e.message }));

  await startCacheService().catch(() => {});
  setAlertWorker(alertWorker);

  await startAlertEngine().catch(e => logger.error({ event: 'alertEngineStartFailed', message: e.message }));
  startRetentionScheduler().catch?.(() => {});
  await startWatcher().catch(e => logger.error({ event: 'watcherStartFailed', message: e.message }));
  const logsDir = (process.env.WATCH_DIRS || './logs').split(',')[0].trim();
  try { if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true }); } catch (_) {}

  // Listen (persistent server only)
  const PORT_NUM = parseInt(process.env.PORT || '3001', 10);
  const server = app.listen(PORT_NUM, () => {
    server.timeout = 300000;
    server.keepAliveTimeout = 310000;
    server.headersTimeout = 320000;
    logger.info({ event: 'server_started', port: PORT_NUM }, `[LogSystem] Running on http://localhost:${PORT_NUM}`);
  });

  const shutdown = (signal) => {
    logger.info(`[${signal}] Shutting down...`);
    alertWorker.closeAll();
    stopWatcher();
    stopAlertEngine();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Start initialization (non-blocking — app already exported below)
initialize().catch(err => {
  logger.error({ event: 'init_failed', message: err.message });
});

// ── EXPORT (must be last, synchronous, and unconditional) ─────────────────────
// Vercel reads this export to find the request handler.
// The app is fully configured above — routes, middleware, session — so it's
// ready to handle requests even before initialize() resolves.
export default app;