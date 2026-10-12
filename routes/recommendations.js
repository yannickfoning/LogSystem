import { Router } from 'express';
import pool from '../config/database.js';
import { requireAuth, userScope } from '../middleware/auth.js';
import logger from '../config/logger.js';

const router = Router();

async function findRecommendation(errorType, { logFormat, eventType, logLevel } = {}) {
  const [rows] = await pool.execute(
    `SELECT recommendation FROM error_recommendations
     WHERE is_active = 1 AND (
       (? <> '' AND error_type = ? AND (log_format IS NULL OR log_format = ?)) OR
       (error_type = '*' AND (
         (? <> '' AND event_type = ?) OR
         (? <> '' AND log_format = ?) OR
         (? <> '' AND log_level = ?)
       ))
     )
     ORDER BY
       CASE
         WHEN ? <> '' AND error_type = ? AND (log_format IS NULL OR log_format = ?) THEN 0
         WHEN ? <> '' AND error_type = '*' AND event_type = ? THEN 1
         WHEN ? <> '' AND error_type = '*' AND log_format = ? THEN 2
         WHEN ? <> '' AND error_type = '*' AND log_level = ? THEN 3
         ELSE 4
       END,
       priority DESC
     LIMIT 1`,
    [
      errorType || '', errorType || '', logFormat || null,
      eventType || '', eventType || '',
      logFormat || '', logFormat || '',
      logLevel || '', logLevel || '',
      errorType || '', errorType || '', logFormat || null,
      eventType || '', eventType || '',
      logFormat || '', logFormat || '',
      logLevel || '', logLevel || '',
    ]
  );
  return rows[0]?.recommendation || null;
}

function deriveIssueAdvice(log, history) {
  const errorType = String(log.error_type || '').toLowerCase();
  const eventType = String(log.event_type || '').toLowerCase();
  const message = String(log.message || '').toLowerCase();
  const context = `${errorType} ${eventType} ${message}`;
  if (/database|sql|query|ora-|deadlock|constraint/.test(context)) {
    return 'Pour ce motif de base de données, vérifiez la requête et ses paramètres, puis contrôlez le schéma, les droits et les verrous dans le service concerné. Comparez les occurrences de la même empreinte avant de modifier les données.';
  }
  if (/invalid|validation|format|parse/.test(context)) {
    return 'Pour cette erreur de validation, relevez le champ et la valeur rejetés dans le message complet, comparez avec une exécution réussie du même service et corrigez le format à la source. Ajoutez ensuite un contrôle d’entrée pour éviter une nouvelle occurrence.';
  }
  if (/auth|credential|permission|unauthorized|forbidden|401|403/.test(context)) {
    return 'Pour cette erreur d’accès, vérifiez l’utilisateur indiqué dans le log, ses rôles et les droits du service cible. Contrôlez aussi l’expiration des identifiants sans les inscrire dans les logs.';
  }
  if (/timeout|timed out|econnrefused|network|connection/.test(context)) {
    return 'Pour cette erreur de connexion, vérifiez l’état du service distant, son adresse et son port, puis contrôlez les délais d’attente et les traces réseau à la même heure.';
  }
  if (/java/.test(String(log.parser_format || '').toLowerCase()) || /exception|error/.test(context)) {
    return 'Pour cette erreur Java, partez de la première cause de la stack trace et du service indiqué. Comparez les logs de même empreinte autour de l’heure de l’incident, puis vérifiez les dépendances et les changements récents.';
  }
  if (Number(history.sameFingerprintOccurrences || 0) >= 3) {
    return 'Ce motif apparaît plusieurs fois dans les logs importés. Regroupez les occurrences par service et heure, corrigez la cause commune, puis vérifiez qu’aucune nouvelle occurrence n’arrive.';
  }
  return 'Comparez ce log aux événements du même service juste avant l’incident, puis vérifiez le premier changement ou la première dépendance en échec avant de relancer le traitement.';
}

async function loadLogHistory(log, scope) {
  const history = {
    sameFingerprintOccurrences: 0,
    sameFingerprintLast7Days: 0,
    matchingTypeOccurrences: 0,
    lastSeen: null,
    recurrent: false,
  };
  if (log.fingerprint) {
    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS total,
              SUM(imported_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)) AS last_7_days,
              MAX(imported_at) AS last_seen
       FROM logs WHERE fingerprint = ?${scope.sql}`,
      [log.fingerprint, ...scope.params],
    );
    history.sameFingerprintOccurrences = Number(rows[0]?.total || 0);
    history.sameFingerprintLast7Days = Number(rows[0]?.last_7_days || 0);
    history.lastSeen = rows[0]?.last_seen || null;
  }

  const matchingField = log.error_type ? 'error_type' : (log.event_type ? 'event_type' : null);
  const matchingValue = log.error_type || log.event_type;
  if (matchingField && log.parser_format) {
    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM logs
       WHERE ${matchingField} = ? AND parser_format = ? AND log_level IN ('ERROR','CRITICAL','FATAL')${scope.sql}`,
      [matchingValue, log.parser_format, ...scope.params],
    );
    history.matchingTypeOccurrences = Number(rows[0]?.total || 0);
  }
  history.recurrent = history.sameFingerprintOccurrences >= 3;
  return history;
}

async function buildMatch(log, scope) {
  const history = await loadLogHistory(log, scope);
  const storedRecommendation = await findRecommendation(log.error_type, {
    logFormat: log.parser_format,
    eventType: log.event_type,
    logLevel: log.log_level,
  });
  const issueAdvice = deriveIssueAdvice(log, history);
  const recommendation = storedRecommendation
    ? `${storedRecommendation}\n\nAnalyse des logs importés : ${issueAdvice}`
    : issueAdvice;
  return {
    recommendation,
    recommendationSource: storedRecommendation ? 'règles de recommandation + historique importé' : 'analyse de l’historique importé',
    history,
  };
}

router.get('/match', requireAuth, async (req, res) => {
  try {
    const scope = userScope(req);
    let log;
    if (req.query.log_id) {
      const logId = Number(req.query.log_id);
      if (!Number.isSafeInteger(logId) || logId <= 0) return res.status(400).json({ error: 'Identifiant de log invalide' });
      const [rows] = await pool.execute(
        `SELECT id, error_type, event_type, parser_format, log_level, message, fingerprint
         FROM logs WHERE id = ?${scope.sql} LIMIT 1`,
        [logId, ...scope.params],
      );
      if (!rows.length) return res.status(404).json({ error: 'Log introuvable' });
      log = rows[0];
    } else {
      log = {
        error_type: req.query.error_type || null,
        parser_format: req.query.log_format || null,
        event_type: req.query.event_type || null,
        log_level: req.query.log_level || null,
      };
    }
    res.json(await buildMatch(log, scope));
  } catch (e) {
    logger.error({ event: 'match_recommendation_error', error: e.message }, '[RECOMMENDATIONS]');
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /recommendations/match/:errorType - Get recommendation for specific error type
// This route must stay before /:id, otherwise "match" is parsed as an id.
router.get('/match/:errorType', requireAuth, async (req, res) => {
  try {
    const scope = userScope(req);
    const match = await buildMatch({
      error_type: req.params.errorType,
      logFormat: req.query.log_format,
      parser_format: req.query.log_format,
      event_type: req.query.event_type,
      log_level: req.query.log_level,
    }, scope);
    res.json(match);
  } catch (e) {
    logger.error({ event: 'match_recommendation_error', error: e.message }, '[RECOMMENDATIONS]');
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /recommendations - Get all recommendations (admin only)
router.get('/', requireAuth, async (req, res) => {
  try {
    const user = req.session?.user;
    const isAdmin = user?.role === 'admin';
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const [rows] = await pool.execute(
      `SELECT r.*, u.display_name as created_by_username 
       FROM error_recommendations r 
       LEFT JOIN users u ON r.created_by = u.id 
       WHERE r.is_active = 1 
       ORDER BY r.priority DESC, r.created_at DESC`
    );
    
    res.json({ recommendations: rows });
  } catch (e) {
    logger.error({ event: 'get_recommendations_error', error: e.message }, '[RECOMMENDATIONS]');
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /recommendations/:id - Get single recommendation
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID invalide' });

    const [rows] = await pool.execute(
      `SELECT r.*, u.display_name as created_by_username 
       FROM error_recommendations r 
       LEFT JOIN users u ON r.created_by = u.id 
       WHERE r.id = ?`,
      [id]
    );
    
    if (!rows.length) return res.status(404).json({ error: 'Recommendation introuvable' });
    res.json(rows[0]);
  } catch (e) {
    logger.error({ event: 'get_recommendation_error', error: e.message }, '[RECOMMENDATIONS]');
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /recommendations - Create new recommendation (admin only)
router.post('/', requireAuth, async (req, res) => {
  try {
    const user = req.session?.user;
    const isAdmin = user?.role === 'admin';
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const { error_type, log_format, event_type, log_level, pattern_keywords, recommendation, priority = 0 } = req.body;
    
    if (!recommendation || !recommendation.trim()) {
      return res.status(400).json({ error: 'La recommandation est requise' });
    }

    const [result] = await pool.execute(
      `INSERT INTO error_recommendations (error_type, log_format, event_type, log_level, pattern_keywords, recommendation, priority, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [error_type || '*', log_format || null, event_type || null, log_level || null, pattern_keywords || null, recommendation.trim(), priority || 0, user.id]
    );
    
    logger.info({ event: 'recommendation_created', id: result.insertId, created_by: user.id }, '[RECOMMENDATIONS]');
    res.status(201).json({ id: result.insertId, message: 'Recommandation créée' });
  } catch (e) {
    logger.error({ event: 'create_recommendation_error', error: e.message }, '[RECOMMENDATIONS]');
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /recommendations/:id - Update recommendation (admin only)
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const user = req.session?.user;
    const isAdmin = user?.role === 'admin';
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID invalide' });

    const { error_type, log_format, event_type, log_level, pattern_keywords, recommendation, priority, is_active } = req.body;
    
    const [existing] = await pool.execute('SELECT id FROM error_recommendations WHERE id = ?', [id]);
    if (!existing.length) return res.status(404).json({ error: 'Recommendation introuvable' });

    await pool.execute(
      `UPDATE error_recommendations 
       SET error_type = ?, log_format = ?, event_type = ?, log_level = ?, pattern_keywords = ?,
           recommendation = ?, priority = ?, is_active = ?, updated_at = NOW()
       WHERE id = ?`,
      [error_type || '*', log_format || null, event_type || null, log_level || null, pattern_keywords || null,
       recommendation?.trim() || null, priority || 0, is_active !== undefined ? (is_active ? 1 : 0) : 1, id]
    );
    
    logger.info({ event: 'recommendation_updated', id, updated_by: user.id }, '[RECOMMENDATIONS]');
    res.json({ message: 'Recommandation mise à jour' });
  } catch (e) {
    logger.error({ event: 'update_recommendation_error', error: e.message }, '[RECOMMENDATIONS]');
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /recommendations/:id - Delete recommendation (admin only)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const user = req.session?.user;
    const isAdmin = user?.role === 'admin';
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID invalide' });

    const [result] = await pool.execute('DELETE FROM error_recommendations WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Recommendation introuvable' });
    
    logger.info({ event: 'recommendation_deleted', id, deleted_by: user.id }, '[RECOMMENDATIONS]');
    res.json({ message: 'Recommandation supprimée' });
  } catch (e) {
    logger.error({ event: 'delete_recommendation_error', error: e.message }, '[RECOMMENDATIONS]');
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
