import crypto from 'crypto';

// SEC-01: CSRF_SECRET must be persistent and defined in .env
const CSRF_SECRET = process.env.CSRF_SECRET;
if (!CSRF_SECRET || CSRF_SECRET.length < 32) {
  throw new Error('[FATAL] CSRF_SECRET must be set in .env with minimum 32 characters');
}

function generateCsrfToken(sessionId) {
  return crypto
    .createHmac('sha256', CSRF_SECRET)
    .update(String(sessionId))
    .digest('hex');
}

export function csrfMiddleware(req, res, next) {
  const sessionId = req.sessionID || req.session?.id || 'anonymous';
  const token = generateCsrfToken(sessionId);
  const isSecure = process.env.NODE_ENV === 'production' || req.headers['x-forwarded-proto'] === 'https';

  if (req.cookies?.csrf_token !== token) {
    res.cookie('csrf_token', token, {
      httpOnly: false,
      sameSite: 'lax',
      secure: isSecure,
      path: '/'
    });
  }
  req.csrfToken = token;
  next();
}

export function setCsrfCookie(res, req, sessionId) {
  const token = generateCsrfToken(sessionId);
  const isSecure = process.env.NODE_ENV === 'production' || req?.headers?.['x-forwarded-proto'] === 'https';
  res.cookie('csrf_token', token, {
    httpOnly: false,
    sameSite: 'lax',
    secure: isSecure,
    path: '/'
  });
  return token;
}

export function clearCsrfCookie(res, req) {
  const isSecure = process.env.NODE_ENV === 'production' || req?.headers?.['x-forwarded-proto'] === 'https';
  res.clearCookie('csrf_token', { path: '/', sameSite: 'lax', secure: isSecure });
}

export function csrfValidation(req, res, next) {
  const method = req.method.toUpperCase();
  if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
    return next();
  }

  const cookieToken = req.cookies && req.cookies.csrf_token;
  const headerToken = req.headers['x-csrf-token'];
  const hasSession = req.session && req.session.user;

  // For authenticated requests, CSRF protection is mandatory
  if (hasSession) {
    if (!cookieToken || !headerToken) {
      return res.status(403).json({ error: 'Token CSRF manquant pour requête authentifiée' });
    }

    const bc = Buffer.from(cookieToken, 'utf8');
    const bh = Buffer.from(headerToken, 'utf8');

    if (bc.length !== bh.length) {
      return res.status(403).json({ error: 'Token CSRF invalide' });
    }

    try {
      const match = crypto.timingSafeEqual(bc, bh);
      if (!match) {
        return res.status(403).json({ error: 'Token CSRF invalide' });
      }
    } catch (_e) {
      return res.status(403).json({ error: 'Token CSRF invalide' });
    }
  }
  // For unauthenticated requests, allow without CSRF (for public endpoints like login)
  // These should implement their own rate limiting and validation

  next();
}
