import { Router } from 'express';
import pool from '../config/database.js';
import { requireAuth, userScope } from '../middleware/auth.js';
import logger from '../config/logger.js';
import { suggestFix, getErrorInfo } from '../services/errorAnalyzer.js';

const router = Router();

async function findRecommendation(errorType, { logFormat, eventType, logLevel } = {}) {
  const [rows] = await pool.execute(
    `SELECT recommendation, has_solution, solution_details FROM error_recommendations
     WHERE is_active = 1 AND has_solution = 0 AND (
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
  return rows[0] || null;
}

function deriveIssueAdvice(log, history) {
  const errorType = String(log.error_type || '').toLowerCase();
  const eventType = String(log.event_type || '').toLowerCase();
  const message = String(log.message || '').toLowerCase();
  const targetUser = log.target_user;
  const context = `${errorType} ${eventType} ${message}`;
  
  let advice = '';
  
  if (/database|sql|query|ora-|deadlock|constraint/.test(context)) {
    advice = `Pour ce motif de base de donnees (utilisateur : ${targetUser}), verifiez la requete et ses parametres, puis controlez le schema, les droits et les verrous dans le service concerne. Comparez les occurrences de la meme empreinte avant de modifier les donnees. Verifiez aussi les permissions de l utilisateur ${targetUser} sur la base de donnees.`;
  } else if (/invalid|validation|format|parse/.test(context)) {
    advice = `Pour cette erreur de validation (utilisateur : ${targetUser}), relevez le champ et la valeur rejetes dans le message complet, comparez avec une execution reussie du meme service et corrigez le format a la source. Ajoutez ensuite un controle d entree pour eviter une nouvelle occurrence. Verifiez les donnees fournies par l utilisateur ${targetUser}.`;
  } else if (/auth|credential|permission|unauthorized|forbidden|401|403/.test(context)) {
    advice = `Pour cette erreur d acces (utilisateur : ${targetUser}), verifiez l utilisateur indique dans le log, ses roles et les droits du service cible. Controlez aussi l expiration des identifiants sans les inscrire dans les logs.`;
  } else if (/timeout|timed out|econnrefused|network|connection/.test(context)) {
    advice = `Pour cette erreur de connexion (utilisateur : ${targetUser}), verifiez l etat du service distant, son adresse et son port, puis controlez les delais d attente et les traces reseau a la meme heure. Verifiez si l utilisateur ${targetUser} a acces au service.`;
  } else if (/java/.test(String(log.parser_format || '').toLowerCase()) || /exception|error/.test(context)) {
    advice = `Pour cette erreur Java (utilisateur : ${targetUser}), partez de la premiere cause de la stack trace et du service indique. Comparez les logs de meme empreinte autour de l heure de l incident, puis verifiez les dependances et les changements recents.`;
  } else if (Number(history.sameFingerprintOccurrences || 0) >= 3) {
    advice = `Ce motif apparait plusieurs fois dans les logs importes (utilisateur : ${targetUser}). Regroupez les occurrences par service et heure, corrigez la cause commune, puis verifiez qu aucune nouvelle occurrence n arrive.`;
  } else {
    advice = `Comparez ce log (utilisateur : ${targetUser}) aux evenements du meme service juste avant l incident, puis verifiez le premier changement ou la premiere dependance en echec avant de relancer le traitement.`;
  }
  
  return advice;
}

async function loadLogHistory(log, scope) {
  const history = {
    sameFingerprintOccurrences: 0,
    sameFingerprintLast7Days: 0,
    matchingTypeOccurrences: 0,
    lastSeen: null,
    recurrent: false,
    alreadyResolved: false,
    solutionApplied: null,
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

    // Check if this error group has already been resolved with a solution
    const [errorGroups] = await pool.execute(
      `SELECT status, solution_applied, solution_applied_at
       FROM error_groups
       WHERE fingerprint = ?${scope.sql} AND status = 'resolved'
       LIMIT 1`,
      [log.fingerprint, ...scope.params],
    );
    if (errorGroups.length > 0) {
      history.alreadyResolved = true;
      history.solutionApplied = errorGroups[0].solution_applied;
    }
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
  const targetUser = log.target_user;

  // If this error group is already resolved, return the solution that was applied
  if (history.alreadyResolved && history.solutionApplied) {
    return {
      recommendation: `Ce probleme a deja ete resolu (utilisateur : ${targetUser}).\n\nSolution appliquee : ${history.solutionApplied}\n\nDate de resolution : ${history.lastSeen ? new Date(history.lastSeen).toLocaleString('fr-FR') : 'Non disponible'}`,
      recommendationSource: 'solution deja appliquee',
      history,
      isResolved: true,
      target_user: targetUser
    };
  }

  const storedRecommendation = await findRecommendation(log.error_type, {
    logFormat: log.parser_format,
    eventType: log.event_type,
    logLevel: log.log_level,
  });

  // Get detailed fix suggestions from errorAnalyzer
  const errorInfo = getErrorInfo(log.error_type, log.message);
  const fixSuggestion = suggestFix(log.error_type, log.message, log.stack_trace);

  // If a recommendation with a known solution exists, show it
  if (storedRecommendation && storedRecommendation.has_solution) {
    const issueAdvice = deriveIssueAdvice(log, history);
    return {
      recommendation: `Solution connue disponible (utilisateur : ${targetUser}) :\n\n${storedRecommendation.solution_details || storedRecommendation.recommendation}\n\nContexte : ${issueAdvice}`,
      recommendationSource: 'solution connue + historique importe',
      history,
      hasKnownSolution: true,
      target_user: targetUser,
      errorInfo: errorInfo,
      fixSuggestion: fixSuggestion
    };
  }

  // Otherwise, use the standard recommendation logic with enhanced fix suggestions
  const issueAdvice = deriveIssueAdvice(log, history);
  const recommendation = storedRecommendation
    ? `${storedRecommendation.recommendation}\n\nAnalyse des logs importes : ${issueAdvice}`
    : issueAdvice;

  // Add detailed fix suggestion if available
  let enhancedRecommendation = recommendation;
  if (fixSuggestion && fixSuggestion !== 'Aucune suggestion automatique disponible. Consultez la documentation du module ou cherchez l\'erreur exacte dans la communauté.') {
    enhancedRecommendation = `${recommendation}\n\n🔧 Solution suggeree :\n${fixSuggestion}`;
  }

  return {
    recommendation: enhancedRecommendation,
    recommendationSource: storedRecommendation ? 'regles de recommandation + historique importe + analyse intelligente' : 'analyse de l historique importe + analyse intelligente',
    history,
    target_user: targetUser,
    errorInfo: errorInfo,
    fixSuggestion: fixSuggestion
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
      return res.status(403).json({ error: 'Acces refuse' });
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
      return res.status(403).json({ error: 'Acces refuse' });
    }

    const { error_type, log_format, event_type, log_level, pattern_keywords, recommendation, priority = 0, has_solution = 0, solution_details } = req.body;
    
    if (!recommendation || !recommendation.trim()) {
      return res.status(400).json({ error: 'La recommandation est requise' });
    }

    const [result] = await pool.execute(
      `INSERT INTO error_recommendations (error_type, log_format, event_type, log_level, pattern_keywords, recommendation, priority, created_by, has_solution, solution_details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [error_type || '*', log_format || null, event_type || null, log_level || null, pattern_keywords || null, recommendation.trim(), priority || 0, user.id, has_solution ? 1 : 0, solution_details || null]
    );
    
    logger.info({ event: 'recommendation_created', id: result.insertId, created_by: user.id }, '[RECOMMENDATIONS]');
    res.status(201).json({ id: result.insertId, message: 'Recommandation creee' });
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
      return res.status(403).json({ error: 'Acces refuse' });
    }

    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID invalide' });

    const { error_type, log_format, event_type, log_level, pattern_keywords, recommendation, priority, is_active, has_solution, solution_details } = req.body;
    
    const [existing] = await pool.execute('SELECT id FROM error_recommendations WHERE id = ?', [id]);
    if (!existing.length) return res.status(404).json({ error: 'Recommendation introuvable' });

    await pool.execute(
      `UPDATE error_recommendations 
       SET error_type = ?, log_format = ?, event_type = ?, log_level = ?, pattern_keywords = ?,
           recommendation = ?, priority = ?, is_active = ?, updated_at = NOW(), has_solution = ?, solution_details = ?
       WHERE id = ?`,
      [error_type || '*', log_format || null, event_type || null, log_level || null, pattern_keywords || null,
       recommendation?.trim() || null, priority || 0, is_active !== undefined ? (is_active ? 1 : 0) : 1, has_solution !== undefined ? (has_solution ? 1 : 0) : 0, solution_details || null, id]
    );
    
    logger.info({ event: 'recommendation_updated', id, updated_by: user.id }, '[RECOMMENDATIONS]');
    res.json({ message: 'Recommandation mise a jour' });
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
      return res.status(403).json({ error: 'Acces refuse' });
    }

    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID invalide' });

    const [result] = await pool.execute('DELETE FROM error_recommendations WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Recommendation introuvable' });
    
    logger.info({ event: 'recommendation_deleted', id, deleted_by: user.id }, '[RECOMMENDATIONS]');
    res.json({ message: 'Recommandation supprimee' });
  } catch (e) {
    logger.error({ event: 'delete_recommendation_error', error: e.message }, '[RECOMMENDATIONS]');
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /recommendations/:id/mark-solved - Mark an error group as solved with a solution
router.post('/:errorGroupId/mark-solved', requireAuth, async (req, res) => {
  try {
    const user = req.session?.user;
    const errorGroupId = parseInt(req.params.errorGroupId);
    const { solution } = req.body;

    if (isNaN(errorGroupId)) return res.status(400).json({ error: 'ID de groupe invalide' });
    if (!solution || !solution.trim()) return res.status(400).json({ error: 'La solution est requise' });

    const scope = userScope(req);
    const [existing] = await pool.execute(
      `SELECT id FROM error_groups WHERE id = ?${scope.sql}`,
      [errorGroupId, ...scope.params]
    );
    if (!existing.length) return res.status(404).json({ error: 'Groupe d erreurs introuvable' });

    await pool.execute(
      `UPDATE error_groups 
       SET status = 'resolved', 
           solution_applied = ?, 
           solution_applied_at = NOW(), 
           solution_applied_by = ?,
           resolved_at = NOW()
       WHERE id = ?${scope.sql}`,
      [solution.trim(), user.id, errorGroupId, ...scope.params]
    );

    logger.info({ event: 'error_group_marked_solved', errorGroupId, user_id: user.id }, '[RECOMMENDATIONS]');
    res.json({ message: 'Groupe marque comme resolu' });
  } catch (e) {
    logger.error({ event: 'mark_solved_error', error: e.message }, '[RECOMMENDATIONS]');
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
