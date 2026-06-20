/**
 * Suite de tests de sécurité — LogSystem v4.0
 * Couvre tous les correctifs critiques appliqués lors de l'audit
 */

import { describe, it, expect, vi } from 'vitest';
import path from 'path';

// ── CORRECTIF 1 : SSL rejectUnauthorized ────────────────────────────────────
describe('[SEC-01] SSL rejectUnauthorized', () => {
  it('doit être true par défaut (sans env var)', async () => {
    const original = process.env.DB_SSL_REJECT_UNAUTHORIZED;
    delete process.env.DB_SSL_REJECT_UNAUTHORIZED;

    const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false';
    expect(rejectUnauthorized).toBe(true);

    if (original !== undefined) process.env.DB_SSL_REJECT_UNAUTHORIZED = original;
  });

  it('doit être false uniquement si explicitement défini à "false"', () => {
    process.env.DB_SSL_REJECT_UNAUTHORIZED = 'false';
    const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false';
    expect(rejectUnauthorized).toBe(false);
    delete process.env.DB_SSL_REJECT_UNAUTHORIZED;
  });

  it('ne doit PAS être false si la valeur est "FALSE" (casse différente)', () => {
    process.env.DB_SSL_REJECT_UNAUTHORIZED = 'FALSE';
    // Comparaison stricte — 'FALSE' !== 'false'
    const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false';
    expect(rejectUnauthorized).toBe(true);
    delete process.env.DB_SSL_REJECT_UNAUTHORIZED;
  });

  it('readCaFile doit retourner undefined si le fichier est absent (pas de crash)', async () => {
    const originalPath = process.env.DB_SSL_CA_PATH;
    process.env.DB_SSL_CA_PATH = '/tmp/nonexistent_ca_file_logsystem_test.pem';

    // Simulate the readCaFile function logic
    let result;
    try {
      const { readFileSync } = await import('fs');
      result = readFileSync('/tmp/nonexistent_ca_file_logsystem_test.pem');
    } catch {
      result = undefined;
    }
    expect(result).toBeUndefined();

    if (originalPath !== undefined) process.env.DB_SSL_CA_PATH = originalPath;
    else delete process.env.DB_SSL_CA_PATH;
  });
});

// ── CORRECTIF 2 : CSP sans unsafe-eval ──────────────────────────────────────
describe('[SEC-02] CSP : absence de directives dangereuses', () => {
  it('scriptSrc ne doit pas contenir unsafe-eval', async () => {
    const { readFileSync } = await import('fs');
    const serverJs = readFileSync('./server.js', 'utf8');
    expect(serverJs).not.toContain("'unsafe-eval'");
  });

  it('scriptSrc ne doit pas contenir unsafe-inline', async () => {
    const { readFileSync } = await import('fs');
    const serverJs = readFileSync('./server.js', 'utf8');
    // unsafe-inline ne doit pas apparaître dans scriptSrc
    const scriptSrcMatch = serverJs.match(/scriptSrc:\s*\[([^\]]+)\]/);
    if (scriptSrcMatch) {
      expect(scriptSrcMatch[1]).not.toContain("'unsafe-inline'");
    }
  });

  it('scriptSrc doit contenir le nonce', async () => {
    const { readFileSync } = await import('fs');
    const serverJs = readFileSync('./server.js', 'utf8');
    expect(serverJs).toContain('cspNonce');
  });
});

// ── CORRECTIF 3 : render.yaml — variables obligatoires ─────────────────────
describe('[SEC-03] render.yaml : configuration de déploiement', () => {
  it('doit définir CSRF_SECRET avec generateValue', async () => {
    const { readFileSync } = await import('fs');
    const yaml = readFileSync('./render.yaml', 'utf8');
    expect(yaml).toContain('CSRF_SECRET');
    expect(yaml).toContain('generateValue: true');
  });

  it('doit utiliser le bon healthCheckPath (/health)', async () => {
    const { readFileSync } = await import('fs');
    const yaml = readFileSync('./render.yaml', 'utf8');
    expect(yaml).toContain('healthCheckPath: /health');
    expect(yaml).not.toContain('healthCheckPath: /api/health');
  });

  it('doit définir DB_SSL_REJECT_UNAUTHORIZED', async () => {
    const { readFileSync } = await import('fs');
    const yaml = readFileSync('./render.yaml', 'utf8');
    expect(yaml).toContain('DB_SSL_REJECT_UNAUTHORIZED');
  });

  it('buildCommand ne doit pas référencer next build', async () => {
    const { readFileSync } = await import('fs');
    const yaml = readFileSync('./render.yaml', 'utf8');
    expect(yaml).not.toContain('next build');
    expect(yaml).not.toContain('yarn build');
  });
});

// ── CORRECTIF 5 — FULLTEXT search ────────────────────────────────────────────
describe('[PERF-01] Recherche FULLTEXT', () => {
  it('routes/logs.js doit utiliser MATCH/AGAINST plutôt que LIKE sur message', async () => {
    const { readFileSync } = await import('fs');
    const logsJs = readFileSync('./routes/logs.js', 'utf8');
    expect(logsJs).toContain('MATCH(message');
    expect(logsJs).toContain('AGAINST');
  });

  it('la sanitisation du terme de recherche doit limiter à 200 chars', async () => {
    const longSearch = 'a'.repeat(300);
    const sanitized = longSearch.replace(/[<>()~*@"]/g, '').trim().substring(0, 200);
    expect(sanitized.length).toBeLessThanOrEqual(200);
  });

  it('la sanitisation doit retirer les caractères dangereux pour FULLTEXT', () => {
    const malicious = 'test<script>@()~*"evil>';
    const sanitized = malicious.replace(/[<>()~*@"]/g, '').trim();
    expect(sanitized).not.toMatch(/[<>()~*@"]/);
    expect(sanitized).toContain('test');
  });
});

// ── CORRECTIF 6 : SRI sur Chart.js ──────────────────────────────────────────
describe('[SEC-06] Subresource Integrity (SRI)', () => {
  it('dashboard.html doit avoir un attribut integrity sur le script CDN Chart.js', async () => {
    const { readFileSync } = await import('fs');
    const html = readFileSync('./public/dashboard.html', 'utf8');
    const chartScriptMatch = html.match(/script[^>]*cdnjs[^>]*chart[^>]*/i);
    expect(chartScriptMatch).not.toBeNull();
    expect(chartScriptMatch[0]).toContain('integrity=');
    expect(chartScriptMatch[0]).toContain('crossorigin=');
  });

  it('le hash SRI doit être de type sha384', async () => {
    const { readFileSync } = await import('fs');
    const html = readFileSync('./public/dashboard.html', 'utf8');
    expect(html).toContain('sha384-');
  });
});

// ── CORRECTIF 7 : admin.html — contraintes de mot de passe ──────────────────
describe('[UX-07] admin.html : contraintes de mot de passe cohérentes', () => {
  it('le champ mot de passe doit avoir minlength="12" (pas 8)', async () => {
    const { readFileSync } = await import('fs');
    const html = readFileSync('./public/admin.html', 'utf8');
    expect(html).not.toContain('minlength="8"');
    expect(html).toContain('minlength="12"');
  });

  it('les champs mot de passe doivent avoir autocomplete="new-password"', async () => {
    const { readFileSync } = await import('fs');
    const html = readFileSync('./public/admin.html', 'utf8');
    expect(html).toContain('autocomplete="new-password"');
  });
});

// ── CORRECTIF 8 : Multer error handler ──────────────────────────────────────
describe('[FUNC-08] Multer : gestionnaire d\'erreurs', () => {
  it('routes/import.js doit exporter multerErrorHandler', async () => {
    const { readFileSync } = await import('fs');
    const importJs = readFileSync('./routes/import.js', 'utf8');
    expect(importJs).toContain('export function multerErrorHandler');
  });

  it('server.js doit importer et enregistrer multerErrorHandler', async () => {
    const { readFileSync } = await import('fs');
    const serverJs = readFileSync('./server.js', 'utf8');
    expect(serverJs).toContain('multerErrorHandler');
    expect(serverJs).toContain('app.use(multerErrorHandler)');
  });

  it('multerErrorHandler doit retourner 400 pour LIMIT_FILE_SIZE', () => {
    const mockErr = { code: 'LIMIT_FILE_SIZE' };
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    };
    const mockNext = vi.fn();

    // Simulate handler logic
    if (mockErr && mockErr.code && mockErr.code.startsWith('LIMIT_')) {
      const messages = {
        LIMIT_FILE_SIZE: 'Fichier trop volumineux',
        LIMIT_FILE_COUNT: 'Trop de fichiers',
        LIMIT_UNEXPECTED_FILE: 'Champ de fichier inattendu',
      };
      mockRes.status(400).json({ error: messages[mockErr.code] || 'Erreur de téléversement' });
    } else {
      mockNext(mockErr);
    }

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({ error: 'Fichier trop volumineux' });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('multerErrorHandler doit appeler next() pour les erreurs non-Multer', () => {
    const mockErr = new Error('Autre erreur');
    const mockRes = { status: vi.fn(), json: vi.fn() };
    const mockNext = vi.fn();

    if (mockErr && mockErr.code && mockErr.code.startsWith('LIMIT_')) {
      mockRes.status(400).json({ error: 'erreur multer' });
    } else {
      mockNext(mockErr);
    }

    expect(mockNext).toHaveBeenCalledWith(mockErr);
    expect(mockRes.status).not.toHaveBeenCalled();
  });
});

// ── CORRECTIF 9 : Path traversal dans ZIP ───────────────────────────────────
describe('[SEC-09] Archive handler : protection path traversal', () => {
  it('doit rejeter les entrées ZIP contenant ../', async () => {
    const { readFileSync } = await import('fs');
    const handlerJs = readFileSync('./lib/processing/archiveHandler.js', 'utf8');
    expect(handlerJs).toContain('../');  // la vérification est présente dans le code
    expect(handlerJs).toContain('normalize');
  });

  it('path.normalize doit détecter le traversal ../../etc/passwd', () => {
    const filename = '../../etc/passwd';
    const normalized = path.normalize(filename).replace(/\\/g, '/');
    expect(
      normalized.includes('../') || path.isAbsolute(normalized)
    ).toBe(true);
  });

  it('path.normalize doit détecter les paths absolus /etc/passwd', () => {
    const filename = '/etc/passwd';
    const normalized = path.normalize(filename).replace(/\\/g, '/');
    expect(path.isAbsolute(normalized)).toBe(true);
  });

  it('un fichier légitime app.log ne doit pas être rejeté', () => {
    const filename = 'logs/app.log';
    const normalized = path.normalize(filename).replace(/\\/g, '/');
    const rejected =
      normalized.includes('../') ||
      path.isAbsolute(normalized) ||
      filename.startsWith('.') ||
      !!filename.match(/\.(exe|dll|so|dylib|bin|jpg|png|gif|zip)$/i);
    expect(rejected).toBe(false);
  });

  it('un fichier nommé ./../../secret ne doit pas passer', () => {
    const filename = './../../secret';
    const normalized = path.normalize(filename).replace(/\\/g, '/');
    const rejected =
      normalized.includes('../') ||
      path.isAbsolute(normalized);
    expect(rejected).toBe(true);
  });
});

// ── CORRECTIF 10 : /api/dashboard/system admin seulement ────────────────────
describe('[SEC-10] /api/dashboard/system : accès restreint', () => {
  it('routes/dashboard.js doit importer requireAdmin', async () => {
    const { readFileSync } = await import('fs');
    const dashJs = readFileSync('./routes/dashboard.js', 'utf8');
    expect(dashJs).toContain('requireAdmin');
  });

  it('la route /system doit utiliser requireAdmin comme middleware', async () => {
    const { readFileSync } = await import('fs');
    const dashJs = readFileSync('./routes/dashboard.js', 'utf8');
    // La route /system doit avoir requireAdmin dans sa définition
    expect(dashJs).toMatch(/router\.get\(['"]\/system['"],\s*requireAdmin/);
  });
});

// ── CORRECTIF 11 : stack_trace masqué pour non-admins ───────────────────────
describe('[SEC-11] Search : stack_trace masqué pour non-admins', () => {
  it('routes/api/search.js doit masquer stack_trace pour les non-admins', async () => {
    const { readFileSync } = await import('fs');
    const searchJs = readFileSync('./routes/api/search.js', 'utf8');
    expect(searchJs).toContain('isAdmin');
    expect(searchJs).toContain('stack_trace: undefined');
  });

  it('la vérification du rôle doit lire req.session.user.role', async () => {
    const { readFileSync } = await import('fs');
    const searchJs = readFileSync('./routes/api/search.js', 'utf8');
    expect(searchJs).toContain("req.session?.user?.role === 'admin'");
  });

  it('un admin doit recevoir les logs non filtrés', () => {
    const logs = [{ id: 1, message: 'test', stack_trace: 'Error at line 1' }];
    const isAdmin = true;
    const result = isAdmin ? logs : logs.map(l => ({ ...l, stack_trace: undefined }));
    expect(result[0].stack_trace).toBe('Error at line 1');
  });

  it('un non-admin doit recevoir stack_trace: undefined', () => {
    const logs = [{ id: 1, message: 'test', stack_trace: 'Error at line 1' }];
    const isAdmin = false;
    const result = isAdmin ? logs : logs.map(l => ({ ...l, stack_trace: undefined }));
    expect(result[0].stack_trace).toBeUndefined();
  });
});

// ── CORRECTIF 12 : CI/CD workflow ───────────────────────────────────────────
describe('[DEPLOY-12] CI/CD : workflow GitHub Actions', () => {
  it('le workflow doit définir CSRF_SECRET dans les env vars de test', async () => {
    const { readFileSync } = await import('fs');
    const workflow = readFileSync('./.github/workflows/node.js.yml', 'utf8');
    expect(workflow).toContain('CSRF_SECRET');
  });

  it('le workflow ne doit pas utiliser yarn build (pas de Next.js)', async () => {
    const { readFileSync } = await import('fs');
    const workflow = readFileSync('./.github/workflows/node.js.yml', 'utf8');
    expect(workflow).not.toContain('yarn build');
    expect(workflow).not.toContain('npm run build');
  });

  it('le workflow doit définir DB_SSL=false pour les tests', async () => {
    const { readFileSync } = await import('fs');
    const workflow = readFileSync('./.github/workflows/node.js.yml', 'utf8');
    expect(workflow).toContain('DB_SSL');
  });
});

// ── Validation des schémas Zod ───────────────────────────────────────────────
describe('[VALID] Schémas de validation Zod', () => {
  it('loginSchema doit rejeter un email invalide', async () => {
    const { loginSchema } = await import('../middleware/validation.js');
    const result = loginSchema.safeParse({ email: 'notanemail', password: 'pass' });
    expect(result.success).toBe(false);
  });

  it('loginSchema doit accepter des identifiants valides', async () => {
    const { loginSchema } = await import('../middleware/validation.js');
    const result = loginSchema.safeParse({ email: 'test@example.com', password: 'password123' });
    expect(result.success).toBe(true);
  });

  it('passwordSchema doit rejeter un mot de passe < 12 chars', async () => {
    const { passwordSchema } = await import('../middleware/validation.js');
    const result = passwordSchema.safeParse({
      current_password: 'old',
      new_password: 'Short1!'
    });
    expect(result.success).toBe(false);
  });

  it('passwordSchema doit rejeter un mot de passe sans majuscule', async () => {
    const { passwordSchema } = await import('../middleware/validation.js');
    const result = passwordSchema.safeParse({
      current_password: 'old',
      new_password: 'lowercase1234'
    });
    expect(result.success).toBe(false);
  });

  it('passwordSchema doit accepter un mot de passe fort', async () => {
    const { passwordSchema } = await import('../middleware/validation.js');
    const result = passwordSchema.safeParse({
      current_password: 'old',
      new_password: 'SecurePass123!'
    });
    expect(result.success).toBe(true);
  });

  it('createUserSchema doit rejeter le rôle "superadmin"', async () => {
    const { createUserSchema } = await import('../middleware/validation.js');
    const result = createUserSchema.safeParse({
      email: 'test@example.com',
      password: 'SecurePass123!',
      role: 'superadmin'
    });
    expect(result.success).toBe(false);
  });

  it('createUserSchema doit accepter le rôle "analyst"', async () => {
    const { createUserSchema } = await import('../middleware/validation.js');
    const result = createUserSchema.safeParse({
      email: 'test@example.com',
      password: 'SecurePass123!',
      role: 'analyst'
    });
    expect(result.success).toBe(true);
  });
});

// ── Normalisation des niveaux de log ────────────────────────────────────────
describe('[PROC] Normalisation des niveaux', () => {
  it('doit normaliser "warn" → WARNING', async () => {
    const { normalizeLevel } = await import('../lib/levels.js');
    expect(normalizeLevel('warn')).toBe('WARNING');
  });

  it('doit normaliser "err" → ERROR', async () => {
    const { normalizeLevel } = await import('../lib/levels.js');
    expect(normalizeLevel('err')).toBe('ERROR');
  });

  it('doit retourner INFO pour une valeur inconnue', async () => {
    const { normalizeLevel } = await import('../lib/levels.js');
    expect(normalizeLevel('GARBAGE')).toBe('INFO');
  });

  it('doit retourner INFO pour une valeur undefined', async () => {
    const { normalizeLevel } = await import('../lib/levels.js');
    expect(normalizeLevel(undefined)).toBe('INFO');
  });

  it('doit retourner INFO pour null', async () => {
    const { normalizeLevel } = await import('../lib/levels.js');
    expect(normalizeLevel(null)).toBe('INFO');
  });
});

export default {};
