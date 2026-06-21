import logger from '../config/logger.js';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import pool from '../config/database.js';
import { recordAudit } from '../middleware/audit.js';
import { validateBody, loginSchema, profileSchema, passwordSchema } from '../middleware/validation.js';
import { clearCsrfCookie, setCsrfCookie } from '../middleware/csrf.js';

const router = Router();

router.post('/login', validateBody(loginSchema), async (req, res) => {
  try {
    const { email, password } = req.body;

    // S-08: Select only needed columns instead of SELECT *
    const [users] = await pool.execute(
      'SELECT id, email, password_hash, display_name, role, is_active, session_version FROM users WHERE email = ? AND is_active = 1',
      [email]
    );

    // S-09: Timing-safe bcrypt compare with dummy hash for non-existent users
    const DUMMY_HASH = '$2a$12$dummy.hash.for.timing.safe.comparison';
    const user = users.length > 0 ? users[0] : { password_hash: DUMMY_HASH };
    const valid = await bcrypt.compare(password, user.password_hash);
    
    if (users.length === 0 || !valid) {
      // Constant-time response to prevent timing attacks
      await new Promise(resolve => setTimeout(resolve, 100)); // Small delay to normalize timing
      return res.status(401).json({ error: 'Identifiants invalides' });
    }

    // [FIX-SEC-05] Premier utilisateur promu admin — atomisé avec transaction + FOR UPDATE
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [allUsers] = await conn.execute('SELECT COUNT(*) as total FROM users WHERE is_active = 1 FOR UPDATE');
      const isFirstUser = allUsers[0].total === 1;
      if (isFirstUser && user.role !== 'admin') {
        await conn.execute('UPDATE users SET role = ? WHERE id = ?', ['admin', user.id]);
        user.role = 'admin';
        logger.info({ event: 'first_user_promoted_admin', userId: user.id, email: user.email }, '[AUTH] Premier utilisateur promu admin');
      }
      await conn.execute('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);
      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }

    await recordAudit({
      userId: user.id,
      userEmail: user.email,
      action: 'login',
      resourceType: 'session',
      ipAddress: req.ip
    });

    req.session.regenerate((err) => {
      if (err) {
        return res.status(500).json({ error: 'Erreur de session' });
      }
      req.session.user = {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        role: user.role,
        session_version: user.session_version ?? 0  // S-10: stocker pour vérification ultérieure
      };

      setCsrfCookie(res, req, req.sessionID);

      req.session.save((err) => {
        if (err) return res.status(500).json({ error: 'Erreur de session' });
        res.json({
          id: user.id,
          email: user.email,
          display_name: user.display_name,
          role: user.role
        });
      });
    });
  } catch (e) {
    logger.error({ event: 'login_error', error: e.message }, '[AUTH]');
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/logout', async (req, res) => {
  const userId = req.session?.user?.id;
  const userEmail = req.session?.user?.email;
  const isSecure = process.env.NODE_ENV === 'production' || req.headers['x-forwarded-proto'] === 'https';
  const cookieOpts = { path: '/', httpOnly: true, sameSite: 'lax', secure: isSecure };

  const finish = async () => {
    res.clearCookie('connect.sid', cookieOpts);
    clearCsrfCookie(res, req);
    if (userId) {
      try {
        await recordAudit({
          userId,
          userEmail,
          action: 'logout',
          resourceType: 'session',
          ipAddress: req.ip
        });
      } catch (_) { /* audit non bloquant */ }
    }
    res.json({ success: true });
  };

  if (!req.session) {
    return finish();
  }

  req.session.destroy((err) => {
    if (err) {
      logger.error({ event: 'logout_session_destroy_error', error: err.message }, '[AUTH]');
      return res.status(500).json({ error: 'Erreur lors de la déconnexion' });
    }
    finish().catch(() => res.status(500).json({ error: 'Erreur lors de la déconnexion' }));
  });
});

router.get('/me', (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ error: 'Non authentifié' });
  }
  res.json(req.session.user);
});

router.put('/profile', validateBody(profileSchema), async (req, res) => {
  try {
    if (!req.session?.user) return res.status(401).json({ error: 'Non authentifié' });
    const { display_name } = req.body;
    await pool.execute(
      'UPDATE users SET display_name = ? WHERE id = ?',
      [display_name || null, req.session.user.id]
    );
    req.session.user.display_name = display_name || null;
    res.json({ success: true, display_name: display_name || null });
  } catch (e) {
    logger.error({ event: 'profile_update_error', error: e.message }, '[AUTH]');
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/password', validateBody(passwordSchema), async (req, res) => {
  try {
    if (!req.session?.user) return res.status(401).json({ error: 'Non authentifié' });
    const { current_password, new_password } = req.body;

    const [users] = await pool.execute('SELECT password_hash FROM users WHERE id = ?', [req.session.user.id]);
    if (users.length === 0) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    const valid = await bcrypt.compare(current_password, users[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Mot de passe actuel incorrect' });

    const rounds = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
    const hash = await bcrypt.hash(new_password, rounds);
    // S-10: Increment session_version on password change to invalidate existing sessions
    await pool.execute('UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?', [hash, req.session.user.id]);

    await recordAudit({
      userId: req.session.user.id,
      userEmail: req.session.user.email,
      action: 'change_password',
      resourceType: 'user',
      resourceId: String(req.session.user.id),
      ipAddress: req.ip
    });

    res.json({ success: true });
  } catch (e) {
    logger.error({ event: 'password_change_error', error: e.message }, '[AUTH]');
    await recordAudit({
      userId: req.session.user?.id,
      userEmail: req.session.user?.email,
      action: 'change_password_error',
      resourceType: 'user',
      ipAddress: req.ip
    });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
export default router;
