/* eslint-disable no-undef */
/* eslint-disable no-unused-vars */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

import crypto from 'crypto';
import { trackSSEConnection, untrackSSEConnection } from './lib/sseConnectionTracker.js';
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
import pool from './config/database.js';
import { runMigrations } from './lib/database/migrationRunner.js';
import { requireAuth, requireAuthPage, requireAdminPage } from './middleware/auth.js';
import { scopeGuard } from './middleware/scopeGuard.js';
import { csrfMiddleware, csrfValidation } from './middleware/csrf.js';
import authRoutes from './routes/auth.js';
import logsRoutes from './routes/logs.js';
import logsIngestionRoutes from './routes/logs-ingestion.js';
import errorSuggestionsRoutes from './routes/api/error-suggestions.js';
import importRoutes, { multerErrorHandler } from './routes/import.js';
import dashboardRoutes from './routes/dashboard.js';
import adminRoutes from './routes/admin.js';
import searchApiRoutes from './routes/api/search.js';
import recommendationsRoutes from './routes/recommendations.js';
import { alertWorker } from './workers/alertWorker.js';
import { startAlertEngine, setAlertWorker, stopAlertEngine } from './services/alertEngine.js';
import { ensureDefaultRecommendations } from './services/recommendationsSeed.js';
import { startRetentionScheduler } from './services/retentionService.js';
import { startWatcher, stopWatcher, getWatcherStatus } from './services/watcherService.js';
import { startCacheService } from './services/cacheService.js';
import { createHtmlCspMiddleware } from './middleware/htmlCsp.js';
import { initCacheCleanup, updateRecommendationFrequency } from './services/performance-optimizer.js';
import recommendationsAdvancedRoutes from './routes/api/recommendations-advanced.js';
import topErrorsAdvancedRoutes from './routes/dashboard/top-errors-advanced.js';

// ── Detect environment ────────────────────────────────────────────────────────
const IS_PROD = process.env.NODE_ENV === 'production';

// ── Anti-crash global ────────────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  logger.error({ event: 'uncaughtException', message: err.message, stack: err.stack });
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.error({ event: 'unhandledRejection', message: reason?.message || String(reason) });
});

// ── Express app ────────────────────────────────────────────────────────────────
const app = express();
app.set('trust proxy', 1);
const PORT = parseInt(process.env.PORT || '3002', 10);


// ── HTTPS redirect ────────────────────────────────────────────────────────────
// En local (dev), on évite le redirect HTTPS pour pouvoir tester sans erreur TLS.
const shouldForceHttps = IS_PROD && process.env.FORCE_HTTPS !== 'false';
if (shouldForceHttps) {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}


// ── Session secret ────────────────────────────────────────────────────────────
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.includes('change-me') || sessionSecret.length < 32) {
  logger.fatal('[FATAL] SESSION_SECRET must be at least 32 characters and not contain "change-me". Exiting.');
  process.exit(1);
}

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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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

const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500, standardHeaders: true, legacyHeaders: false });
app.use(globalLimiter);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { error: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.' },
  standardHeaders: true, legacyHeaders: false
});

// Add specific rate limiter for alerts/stream to prevent abuse
const alertsStreamLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: 30, // 30 requests per minute
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
  connectionLimit: parseInt(process.env.DB_SESSION_CONNECTION_LIMIT || '10', 10),
  queueLimit: parseInt(process.env.DB_SESSION_QUEUE_LIMIT || '0', 10),
  ssl: sslOpts || undefined,
  clearExpired: true,
  checkExpirationInterval: 900000,
  expiration: 86400000,
  schema: { tableName: 'sessions' }
});

app.use(session({
  secret: sessionSecret,
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
app.use('/api/logs', requireAuth, scopeGuard, logsIngestionRoutes);
app.use('/api/import', requireAuth, scopeGuard, importRoutes);
app.use('/api/dashboard', requireAuth, scopeGuard, dashboardRoutes);
app.use('/api/admin', requireAuth, scopeGuard, adminRoutes);
app.use('/api/search', requireAuth, scopeGuard, searchApiRoutes);
app.use('/api/error-suggestions', requireAuth, scopeGuard, errorSuggestionsRoutes);
app.use('/api/recommendations', requireAuth, scopeGuard, recommendationsRoutes);
app.use('/api/recommendations/advanced', requireAuth, scopeGuard, recommendationsAdvancedRoutes);
app.use('/api/dashboard/top-errors', requireAuth, scopeGuard, topErrorsAdvancedRoutes);

app.get('/api/watchdogs/status', requireAuth, (req, res) => {
  res.json(getWatcherStatus());
});
app.get('/api/alerts/stream', alertsStreamLimiter, requireAuth, (req, res) => {
  const userId = req.session?.user?.id;
  alertWorker.addClient(res, req);
  
  // Clean up connection when client disconnects
  req.on('close', () => {
    if (userId) untrackSSEConnection(userId);
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

// ── Static files ──────────────────────────────────────────────────────────────
const publicDir = path.join(__dirname, 'public');

// Protect static HTML pages that require authentication
app.get('/dashboard.html', requireAuthPage);
app.get('/search.html', requireAuthPage);
app.get('/import.html', requireAuthPage);
app.get('/watchlog.html', requireAuthPage);
app.get('/recommendations.html', requireAuthPage);
app.get('/admin.html', requireAdminPage);

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

// ── Start ───────────────────────────────────────────────────────────────────────────
async function start() {
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

  // Initialiser l'optimisation de performance
  initCacheCleanup();

  // Mettre à jour les fréquences toutes les 5 minutes
  setInterval(async () => {
    try {
      const [users] = await pool.execute('SELECT id FROM users WHERE is_active = 1');
      for (const user of users) {
        await updateRecommendationFrequency(user.id);
      }
    } catch (e) {
      logger.error({ event: 'frequency_update_failed', error: e.message });
    }
  }, 5 * 60 * 1000);

  await startAlertEngine().catch(e => logger.error({ event: 'alertEngineStartFailed', message: e.message }));
  await ensureDefaultRecommendations().catch(e => logger.error({ event: 'recommendationsSeedFailed', message: e.message }));
  startRetentionScheduler();
  // Skip file watcher on Render (ephemeral filesystem)
  if (!process.env.RENDER && !process.env.RENDER_SERVICE_NAME) {
    await startWatcher().catch(e => logger.error({ event: 'watcherStartFailed', message: e.message }));
  } else {
    logger.info({ event: 'watcher_skipped', reason: 'Render environment - ephemeral filesystem' }, '[WATCHER]');
  }
  const logsDir = (process.env.WATCH_DIRS || './logs').split(',')[0].trim();
  try { if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true }); } catch (_) {}
}

// Listen (persistent server for Render)
const PORT_NUM = parseInt(process.env.PORT || '3001', 10);
const server = app.listen(PORT_NUM, async () => {
  server.timeout = 300000;
  server.keepAliveTimeout = 310000;
  server.headersTimeout = 320000;
  logger.info({ event: 'server_started', port: PORT_NUM }, `[LogSystem] Running on http://localhost:${PORT_NUM}`);
  await start();
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