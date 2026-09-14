import { Router } from 'express';
import pool from '../../config/database.js';
import { requireAuth } from '../../middleware/auth.js';
import logger from '../../config/logger.js';

const router = Router();

/**
 * GET /api/dashboard/top-errors-grouped
 * Retourne les groupes d'erreurs classés par occurrence (ordre décroissant)
 * avec nombre d'occurrences affiché en rouge
 */
router.get('/top-errors-grouped', requireAuth, async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    const { limit = 20, sortBy = 'count' } = req.query;

    const [errorGroups] = await pool.execute(
      `SELECT 
        eg.id,
        eg.fingerprint,
        eg.title,
        eg.error_type,
        eg.event_type,
        eg.severity_max,
        eg.occurrence_count,
        eg.first_seen,
        eg.last_seen,
        eg.status,
        eg.return_count,
        eg.returned_at,
        eg.source_server,
        eg.service,
        COUNT(DISTINCT l.id) as recent_count,
        MAX(l.timestamp) as most_recent,
        GROUP_CONCAT(DISTINCT l.module SEPARATOR ',') as affected_modules
       FROM error_groups eg
       LEFT JOIN logs l ON l.fingerprint = eg.fingerprint 
         AND l.user_id = ? 
         AND l.timestamp >= DATE_SUB(NOW(), INTERVAL 7 DAY)
       WHERE eg.user_id = ? AND eg.status IN ('open', 'returned')
       GROUP BY eg.id
       ORDER BY eg.occurrence_count DESC
       LIMIT ?`,
      [userId, userId, parseInt(limit)]
    );

    // Transformer pour le frontend avec indicateurs visuels
    const formatted = errorGroups.map((group, index) => ({
      rank: index + 1,
      id: group.id,
      fingerprint: group.fingerprint,
      title: group.title,
      errorType: group.error_type,
      eventType: group.event_type,
      severity: group.severity_max,
      // 🔴 COMPTEUR EN ROUGE - nombre d'occurrences
      occurrenceCount: {
        value: group.occurrence_count,
        display: `🔴 ${group.occurrence_count}`, // Rouge avec badge
        color: group.occurrence_count > 100 ? '#d32f2f' : group.occurrence_count > 50 ? '#f57c00' : '#fbc02d'
      },
      recentCount: group.recent_count,
      firstSeen: group.first_seen,
      lastSeen: group.last_seen,
      mostRecent: group.most_recent,
      status: group.status,
      returnCount: group.return_count,
      returnedAt: group.returned_at,
      sourceServer: group.source_server,
      service: group.service,
      affectedModules: group.affected_modules ? group.affected_modules.split(',') : [],
      // Indicateurs de performance
      trend: group.recent_count > group.occurrence_count * 0.1 ? 'increasing' : 'stable',
      urgency: group.occurrence_count > 100 ? 'critical' : group.occurrence_count > 50 ? 'high' : 'medium'
    }));

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      totalGroups: formatted.length,
      data: formatted,
      summary: {
        criticalCount: formatted.filter(g => g.urgency === 'critical').length,
        highCount: formatted.filter(g => g.urgency === 'high').length,
        totalOccurrences: formatted.reduce((sum, g) => sum + g.occurrenceCount.value, 0)
      }
    });
  } catch (e) {
    logger.error({ event: 'top_errors_grouped_error', error: e.message });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * GET /api/dashboard/error-group/:id/details
 * Détails complets d'un groupe d'erreurs avec samples
 */
router.get('/error-group/:id/details', requireAuth, async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    const groupId = parseInt(req.params.id);

    const [groupData] = await pool.execute(
      `SELECT * FROM error_groups WHERE id = ? AND user_id = ?`,
      [groupId, userId]
    );

    if (!groupData.length) {
      return res.status(404).json({ error: 'Groupe non trouvé' });
    }

    const group = groupData[0];

    // Récupérer les samples récents
    const [samples] = await pool.execute(
      `SELECT id, timestamp, message, stack_trace, log_level, source, service, module
       FROM logs
       WHERE fingerprint = ? AND user_id = ?
       ORDER BY timestamp DESC
       LIMIT 10`,
      [group.fingerprint, userId]
    );

    res.json({
      success: true,
      group: {
        ...group,
        occurrenceCount: {
          value: group.occurrence_count,
          display: `🔴 ${group.occurrence_count}`,
          color: group.occurrence_count > 100 ? '#d32f2f' : '#f57c00'
        }
      },
      samples,
      stats: {
        averagePerDay: (group.occurrence_count / 7).toFixed(1),
        lastOccurrenceMinutesAgo: Math.floor((Date.now() - new Date(group.last_seen)) / 60000)
      }
    });
  } catch (e) {
    logger.error({ event: 'error_group_details_error', error: e.message });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;