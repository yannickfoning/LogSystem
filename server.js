import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

import crypto from 'crypto';
import logger from './config/logger.js';

// ── Patch anti-crash global ───────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  logger.error({ event: 'uncaughtException', message: err.message, stack: err.stack, timestamp: new Date().toISOString() });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error({
    event: 'unhandledRejection',
    message: reason?.message || String(reason),
    stack: reason?.stack,
    timestamp: new Date().toISOString()
  });
});

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
import { requireAuth, requireAuthPage, requireAdminPage } from './middleware/auth.js';
import { scopeGuard } from './middleware/scopeGuard.js';
import { csrfMiddleware, csrfValidation } from './middleware/csrf.js';
import authRoutes from './routes/auth.js';
import logsRoutes from './routes/logs.js';
import importRoutes from './routes/import.js';
import dashboardRoutes from './routes/dashboard.js';
import adminRoutes from './routes/admin.js';
import { alertWorker } from './workers/alertWorker.js';
import { startAlertEngine, setAlertWorker, stopAlertEngine } from './services/alertEngine.js';
import { startRetentionScheduler } from './services/retentionService.js';
import { startWatcher, stopWatcher } from './services/watcherService.js';
// BUG-03 FIX: Démarrer le service cache Redis qui n'était jamais initialisé
import { startCacheService } from './services/cacheService.js';
import { createHtmlCspMiddleware } from './middleware/htmlCsp.js';

const app = express();`napp.set('trust proxy', 1);
app.set('trust proxy', 1);
const PORT = parseInt(process.env.PORT || '3001', 10); // FIX: fallback cohérent avec .env

// Forcer HTTPS en production
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

// Session secret check
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.includes('change-me') || sessionSecret.length < 32) {
  logger.fatal('[FATAL] SESSION_SECRET must be at least 32 characters and not contain "change-me". Exiting.');
  process.exit(1);
}

// BUG-06 FIX: Nonce CSP dynamique par requête (au lieu d'un nonce statique global)
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

app.use(compression({
  filter: (req, res) => {
    if (req.path.endsWith('/stream') || req.headers.accept === 'text/event-stream') {
      return false;
    }
    return compression.filter(req, res);
  }
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// BUG-06 FIX: Helmet avec nonce dynamique via res.locals
app.use((req, res, next) => {
  helmet({
    hsts: process.env.NODE_ENV === 'production'
      ? { maxAge: 31536000, includeSubDomains: true }
      : false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", `'nonce-${res.locals.cspNonce}'`, "https://cdnjs.cloudflare.com", "https://unpkg.com"],
        // FIX: scriptSrcAttr unsafe-inline supprimé — utilisez le nonce sur les handlers inline
        styleSrc: ["'self'", `'nonce-${res.locals.cspNonce}'`, "https://cdnjs.cloudflare.com"],
        styleSrcAttr: ["'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "https://cdnjs.cloudflare.com"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      }
    },
    crossOriginEmbedderPolicy: false
  })(req, res, next);
});

const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500, standardHeaders: true, legacyHeaders: false });
app.use(globalLimiter);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

const MySQLSessionStore = MySQLStore(session);
const sessionStore = new MySQLSessionStore({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: buildSslOptions(),
  createDatabaseTable: true,
  clearExpired: true,
  checkExpirationInterval: 900000,
  expiration: 86400000
});

app.use(session({
  secret: sessionSecret,
  resave: true,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    httpOnly: true,
    // En dev, ne pas exiger HTTPS strictement sinon la session saute.
    secure: process.env.NODE_ENV === 'production',
    maxAge: 86400000,
    // sameSite strict casse fréquemment les scripts/clients non-navigateurs.
    sameSite: 'lax'
  }
}));

app.use((req, res, next) => {
  const isSecure = process.env.NODE_ENV === 'production' || req.headers['x-forwarded-proto'] === 'https';
  if (req.session && req.session.cookie) req.session.cookie.secure = isSecure;
  next();
});

app.use(csrfMiddleware);
app.use(csrfValidation);

app.use('/admin.html', requireAdminPage);
app.use(['/dashboard.html', '/search.html', '/import.html', '/watchlog.html'], requireAuthPage);
app.use((req, res, next) => {
  if (req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
const publicDir = path.join(__dirname, 'public');
app.use(createHtmlCspMiddleware(publicDir));
app.use(express.static(publicDir, { index: false }));

// API Routes
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/logs', requireAuth, scopeGuard, logsRoutes);
app.use('/api/import', requireAuth, scopeGuard, importRoutes);
app.use('/api/dashboard', requireAuth, scopeGuard, dashboardRoutes);
app.use('/api/admin', requireAuth, scopeGuard, adminRoutes);

// SSE Alert Stream
app.get('/api/alerts/stream', requireAuth, (req, res) => {
  alertWorker.addClient(res, req);
});

// SPA fallback
app.get('/', (req, res) => {
  if (req.session?.user) return res.redirect('/dashboard.html');
  res.redirect('/login.html');
});

// 404
app.use((req, res) => { res.status(404).json({ error: 'Route non trouvée' }); });

// Global error handler
app.use((err, req, res, _next) => {
  logger.error('[ERROR]', err.message);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

// ── Start ───────────────────────────────────────────────────────────────────────────
async function start() {
  try {
    await testConnection();
  } catch (e) {
    logger.error({ event: 'db_connection_failed', error: e.message }, '[FATAL]');
    process.exit(1);
  }

  // MIGRATION: Run all pending migrations
  logger.info({ event: 'starting_migrations' }, '[MIGRATION]');
  const migrationsSucceeded = await runMigrations();
  if (!migrationsSucceeded) {
    logger.warn({ event: 'migrations_had_errors' }, '[MIGRATION]');
    // Don't exit — continue running, migrations are idempotent
  }

  // BUG-03 FIX: Démarrage explicite du service cache Redis
  const cacheStarted = await startCacheService();
  if (!cacheStarted) {
    logger.warn('[CACHE] Redis not available — running without cache (degraded mode)');
  }

  setAlertWorker(alertWorker);
  try {
    await startAlertEngine();
  } catch (e) {
    logger.error({ event: 'alertEngineStartFailed', message: e.message });
  }
  try {
    startRetentionScheduler();
  } catch (e) {
    logger.error({ event: 'retentionStartFailed', message: e.message });
  }
  try {
    await startWatcher();
  } catch (e) {
    logger.error({ event: 'watcherStartFailed', message: e.message });
  }

  const logsDir = (process.env.WATCH_DIRS || './logs').split(',')[0].trim();
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
    logger.info({ level: 'info', message: `[INIT] Created log directory: ${logsDir}` });
  }

  const server = app.listen(PORT, () => {
    logger.info({ level: 'info', message: `[LogSystem] Running on http://localhost:${PORT}` });
    logger.info({ level: 'info', message: `[LogSystem] Environment: ${process.env.NODE_ENV || 'development'}` });
    logger.info({ level: 'info', message: `[LogSystem] Cache: ${cacheStarted ? 'Redis actif' : 'désactivé'}` });
  });

  const shutdown = (signal) => {
    logger.info(`[${signal}] Shutting down gracefully...`);
    alertWorker.closeAll();
    stopWatcher();
    stopAlertEngine();
    server.close(() => {
      logger.info('[SHUTDOWN] HTTP server closed');
      process.exit(0);
    });
    setTimeout(() => {
      logger.error('[SHUTDOWN] Forced exit after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  logger.fatal({ event: 'startupFailed', message: err.message, stack: err.stack });
  process.exit(1);
});

