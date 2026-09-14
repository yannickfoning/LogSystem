import { Router } from 'express';
import pool from '../../config/database.js';
import { requireAuth } from '../../middleware/auth.js';
import logger from '../../config/logger.js';

const router = Router();

/**
 * GET /api/recommendations/by-frequency
 * Retourne les recommandations groupées par fréquence d'erreurs
 */
router.get('/by-frequency', requireAuth, async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    const { limit = 15, min_occurrences = 5 } = req.query;

    const [frequentErrors] = await pool.execute(
      `SELECT 
        rf.error_type,
        rf.occurrence_count,
        rf.log_level,
        er.recommendation,
        er.priority,
        er.recommendation_category,
        er.severity_level,
        rf.last_triggered,
        COUNT(DISTINCT l.id) as sample_count
       FROM recommendation_frequency rf
       LEFT JOIN error_recommendations er ON rf.recommendation_id = er.id
       LEFT JOIN logs l ON l.error_type = rf.error_type AND l.user_id = ?
       WHERE rf.user_id = ? AND rf.occurrence_count >= ?
       GROUP BY rf.error_type, rf.log_level
       ORDER BY rf.occurrence_count DESC, er.priority DESC
       LIMIT ?`,
      [userId, userId, parseInt(min_occurrences), parseInt(limit)]
    );

    res.json({
      success: true,
      data: frequentErrors.map(err => ({
        errorType: err.error_type,
        occurrences: err.occurrence_count,
        logLevel: err.log_level,
        recommendation: err.recommendation,
        category: err.recommendation_category,
        severity: err.severity_level,
        lastTriggered: err.last_triggered,
        sampleCount: err.sample_count
      }))
    });
  } catch (e) {
    logger.error({ event: 'rec_frequency_error', error: e.message });
    res.status(500).json({ error: 'Erreur serveur', code: 'REC_FREQ_ERROR' });
  }
});

/**
 * GET /api/recommendations/by-category/:category
 * Filtrer les recommandations par catégorie
 */
router.get('/by-category/:category', requireAuth, async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    const { category } = req.params;
    const validCategories = ['database', 'authentication', 'performance', 'memory', 'network', 'general'];

    if (!validCategories.includes(category)) {
      return res.status(400).json({ error: 'Catégorie invalide' });
    }

    const [recommendations] = await pool.execute(
      `SELECT 
        er.*,
        COUNT(DISTINCT rf.error_type) as frequency_count,
        SUM(rf.occurrence_count) as total_occurrences
       FROM error_recommendations er
       LEFT JOIN recommendation_frequency rf ON er.id = rf.recommendation_id AND rf.user_id = ?
       WHERE er.recommendation_category = ? AND er.is_active = 1
       GROUP BY er.id
       ORDER BY COALESCE(SUM(rf.occurrence_count), 0) DESC, er.priority DESC`,
      [userId, category]
    );

    res.json({
      success: true,
      category,
      data: recommendations
    });
  } catch (e) {
    logger.error({ event: 'rec_category_error', error: e.message });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * POST /api/recommendations/analyze-pattern
 * Analyser les patterns d'erreurs et suggérer des recommandations
 */
router.post('/analyze-pattern', requireAuth, async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    const { timeWindow = 24 } = req.body;

    // Récupérer les erreurs fréquentes du dernier N heures
    const [patterns] = await pool.execute(
      `SELECT 
        error_type,
        log_level,
        event_type,
        COUNT(*) as frequency,
        MAX(timestamp) as last_occurrence
       FROM logs
       WHERE user_id = ? 
       AND timestamp >= DATE_SUB(NOW(), INTERVAL ? HOUR)
       AND log_level IN ('ERROR', 'CRITICAL', 'FATAL')
       GROUP BY error_type, log_level, event_type
       HAVING frequency >= 3
       ORDER BY frequency DESC
       LIMIT 20`,
      [userId, timeWindow]
    );

    // Trouver les recommandations correspondantes
    const enriched = await Promise.all(patterns.map(async (pattern) => {
      const [rec] = await pool.execute(
        `SELECT recommendation, priority, severity_level
         FROM error_recommendations
         WHERE error_type = ? AND is_active = 1
         ORDER BY priority DESC LIMIT 1`,
        [pattern.error_type]
      );

      return {
        ...pattern,
        recommendation: rec[0]?.recommendation || null,
        priority: rec[0]?.priority || 0,
        severity: rec[0]?.severity_level || 'info',
        actionable: rec.length > 0
      };
    }));

    res.json({
      success: true,
      timeWindow,
      patterns: enriched
    });
  } catch (e) {
    logger.error({ event: 'pattern_analysis_error', error: e.message });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;