import { Router } from 'express';
import pool from '../config/database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import logger from '../config/logger.js';

const router = Router();

// GET /recommendations/match/:errorType - Get recommendation for specific error type
// This route must stay before /:id, otherwise "match" is parsed as an id.
router.get('/match/:errorType', requireAuth, async (req, res) => {
  try {
    const { errorType } = req.params;
    const { event_type, log_level } = req.query;
    
    let sql = `SELECT recommendation FROM error_recommendations WHERE is_active = 1 AND error_type = ?`;
    const params = [errorType];
    
    if (event_type) {
      sql += ' AND (event_type IS NULL OR event_type = ?)';
      params.push(event_type);
    }
    
    if (log_level) {
      sql += ' AND (log_level IS NULL OR log_level = ?)';
      params.push(log_level);
    }
    
    sql += ' ORDER BY priority DESC LIMIT 1';
    
    const [rows] = await pool.execute(sql, params);
    
    if (rows.length > 0) {
      res.json({ recommendation: rows[0].recommendation });
    } else {
      res.json({ recommendation: null });
    }
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

    const { error_type, event_type, log_level, pattern_keywords, recommendation, priority = 0 } = req.body;
    
    if (!recommendation || !recommendation.trim()) {
      return res.status(400).json({ error: 'La recommandation est requise' });
    }

    const [result] = await pool.execute(
      `INSERT INTO error_recommendations (error_type, event_type, log_level, pattern_keywords, recommendation, priority, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [error_type || null, event_type || null, log_level || null, pattern_keywords || null, recommendation.trim(), priority || 0, user.id]
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

    const { error_type, event_type, log_level, pattern_keywords, recommendation, priority, is_active } = req.body;
    
    const [existing] = await pool.execute('SELECT id FROM error_recommendations WHERE id = ?', [id]);
    if (!existing.length) return res.status(404).json({ error: 'Recommendation introuvable' });

    await pool.execute(
      `UPDATE error_recommendations 
       SET error_type = ?, event_type = ?, log_level = ?, pattern_keywords = ?, 
           recommendation = ?, priority = ?, is_active = ?, updated_at = NOW()
       WHERE id = ?`,
      [error_type || null, event_type || null, log_level || null, pattern_keywords || null, 
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
