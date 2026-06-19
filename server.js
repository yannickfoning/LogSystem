import 'dotenv/config';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

import crypto from 'crypto';
import logger from './config/logger.js';

// ── Anti-crash global ────────────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  logger.error({ event: 'uncaughtException', message: err.message, stack: err.stack, timestamp: new Date().toISOString() });
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.error({ event: 'unhandledRejection', message: reason?.message || String(reason), stack: reason?.stack, timestamp: new Date().toISOString() });
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

const app = express();
app.set('trust proxy', 1);
const PORT = parseInt(process.env.PORT || '3001', 10);

// ── HTTPS redirect en production ─────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

// ── Validation SESSION_SECRET ─────────────────────────────────────────────────
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.includes('change-me') || sessionSecret.length < 32) {
  logger.fatal('[FATAL] SESSION_SECRET must be at least 32 characters. Exiting.');
  process.exit(1);
}

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
    hsts: process.env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
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

const MySQLSessionStore = MySQLStore(session);
const sessionStore = new MySQLSessionStore({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: buildSslOptions(),
  clearExpired: true,
  checkExpirationInterval: 900000,
  expiration: 86400000
});

app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 86400000,
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

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/logs', requireAuth, scopeGuard, logsRoutes);
app.use('/api/import', requireAuth, scopeGuard, importRoutes);
app.use('/api/dashboard', requireAuth, scopeGuard, dashboardRoutes);
app.use('/api/admin', requireAuth, scopeGuard, adminRoutes);
app.use('/api/search', requireAuth, scopeGuard, searchApiRoutes);

// SSE Alert Stream

// Watchdogs status
app.get('/api/watchdogs/status', requireAuth, (req, res) => {
  res.json(getWatcherStatus());
});
app.get('/api/alerts/stream', requireAuth, (req, res) => {
  alertWorker.addClient(res, req);
});

// Health check Express (avant Next.js)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

// Frontend HTML classique
const publicDir = path.join(__dirname, 'public');
app.use(createHtmlCspMiddleware(publicDir));
app.use(express.static(publicDir, { index: false }));
app.get('/', (req, res) => {
  if (req.session?.user) return res.redirect('/dashboard.html');
  res.redirect('/login.html');
});

// [FIX-12] Multer error handler — before generic 500 handler
app.use(multerErrorHandler);

app.use((err, req, res, _next) => {
  logger.error({ event: 'express_error', message: err.message, stack: err.stack, path: req.path });
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

// ── Startup ───────────────────────────────────────────────────────────────────
async function start() {
  try {
    await testConnection();
    logger.info({ event: 'db_connection_success', env: process.env.NODE_ENV }, '[DB]');
  } catch (e) {
    logger.error({ event: 'db_connection_failed', error: e.message }, '[FATAL]');
    process.exit(1);
  }

  await runMigrations();

  const cacheStarted = await startCacheService();
  if (!cacheStarted) logger.warn('[CACHE] Redis not available — running without cache (degraded mode)');

  setAlertWorker(alertWorker);
  try { await startAlertEngine(); } catch (e) { logger.error({ event: 'alertEngineStartFailed', message: e.message }); }
  try { startRetentionScheduler(); } catch (e) { logger.error({ event: 'retentionStartFailed', message: e.message }); }
  try { await startWatcher(); } catch (e) { logger.error({ event: 'watcherStartFailed', message: e.message }); }

  const logsDir = (process.env.WATCH_DIRS || './logs').split(',')[0].trim();
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

  const server = app.listen(PORT, () => {
  server.timeout = 300000;       // 5min - upload timeout
  server.keepAliveTimeout = 310000;
  server.headersTimeout = 320000;
    logger.info({ event: 'server_started', port: PORT, env: process.env.NODE_ENV || 'development', cache: cacheStarted ? 'redis' : 'disabled' }, `[LogSystem] Running on http://localhost:${PORT}`);
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
