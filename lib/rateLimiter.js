/**
 * LogSystem v6 — Route-specific rate limiters
 */
import rateLimit from 'express-rate-limit';

export const importLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: parseInt(process.env.IMPORT_RATE_MAX || '10', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop d'imports. Réessayez dans 1 heure." },
  keyGenerator: (req) => req.session?.user?.id?.toString() || req.ip,
});

export const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.SEARCH_RATE_MAX || '100', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de recherches. Réessayez dans une minute.' },
  keyGenerator: (req) => req.session?.user?.id?.toString() || req.ip,
});

export default { importLimiter, searchLimiter };
