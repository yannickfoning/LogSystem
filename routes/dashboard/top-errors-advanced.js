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
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isInteger(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 100)
      : 20;
    const requestedRange = String(req.query.timeRange || 'all').trim().toLowerCase();
    const rangeFilters = {
      '24h': 'AND l.timestamp >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY)',
      '7d': 'AND l.timestamp >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)',
      '30d': 'AND l.timestamp >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)',
    };
    const timeRange = requestedRange === 'all' || rangeFilters[requestedRange]
      ? requestedRange
      : 'all';
    const rangeFilter = rangeFilters[timeRange] || '';
    const severity = ['critical', 'high', 'medium'].includes(String(req.query.severity || '').toLowerCase())
      ? String(req.query.severity).toLowerCase()
      : 'all';
    const search = String(req.query.search || '').trim().slice(0, 120);
    // Keep one-off errors visible too; imported datasets often contain many
    // distinct fingerprints, and an empty Top errors panel hides real failures.
    const havingFilters = ['COUNT(DISTINCT l.id) >= 1'];
    const queryParams = [userId];

    if (severity === 'critical') havingFilters.push('COUNT(DISTINCT l.id) > 100');
    if (severity === 'high') havingFilters.push('COUNT(DISTINCT l.id) > 50 AND COUNT(DISTINCT l.id) <= 100');
    if (severity === 'medium') havingFilters.push('COUNT(DISTINCT l.id) <= 50');
    if (search) {
      havingFilters.push(`(
        COALESCE(NULLIF(MAX(eg.title), ''), NULLIF(MAX(l.error_type), ''),
          NULLIF(MAX(l.event_type), ''), LEFT(MAX(l.message), 500)) LIKE ?
        OR l.fingerprint LIKE ?
      )`);
      const searchPattern = `%${search}%`;
      queryParams.push(searchPattern, searchPattern);
    }

    const [errorGroups] = await pool.execute(
      `SELECT
        MAX(eg.id) AS id,
        l.fingerprint,
        COALESCE(NULLIF(MAX(eg.title), ''), NULLIF(MAX(l.error_type), ''),
          NULLIF(MAX(l.event_type), ''), LEFT(MAX(l.message), 500)) AS title,
        MAX(l.error_type) AS error_type,
        MAX(l.event_type) AS event_type,
        CASE MAX(CASE l.log_level
          WHEN 'FATAL' THEN 3
          WHEN 'CRITICAL' THEN 2
          ELSE 1
        END)
          WHEN 3 THEN 'FATAL'
          WHEN 2 THEN 'CRITICAL'
          ELSE 'ERROR'
        END AS severity_max,
        COUNT(DISTINCT l.id) AS occurrence_count,
        MIN(l.timestamp) AS first_seen,
        MAX(l.timestamp) AS last_seen,
        MAX(eg.status) AS status,
        MAX(eg.return_count) AS return_count,
        MAX(eg.returned_at) AS returned_at,
        MAX(l.source_server) AS source_server,
        MAX(l.service) AS service,
        COUNT(DISTINCT CASE
          WHEN l.timestamp >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY) THEN l.id
        END) AS recent_count,
        MAX(l.timestamp) AS most_recent,
        GROUP_CONCAT(DISTINCT NULLIF(l.module, '') ORDER BY l.module SEPARATOR ',') AS affected_modules,
        MAX(l.id) AS sample_log_id
       FROM logs l
       LEFT JOIN error_groups eg ON eg.fingerprint = l.fingerprint AND eg.user_id = l.user_id
       WHERE l.user_id = ?
         AND l.fingerprint IS NOT NULL AND TRIM(l.fingerprint) <> ''
         AND l.log_level IN ('ERROR', 'CRITICAL', 'FATAL')
         AND (eg.status IS NULL OR eg.status != 'resolved')
         ${rangeFilter}
       GROUP BY l.fingerprint
       HAVING ${havingFilters.join(' AND ')}
       ORDER BY occurrence_count DESC, most_recent DESC, l.fingerprint ASC
       LIMIT ${limit}`,
      queryParams
    );

    // Récupérer les recommandations pour chaque groupe d'erreurs
    const errorTypes = errorGroups.map(g => g.error_type).filter(Boolean);
    
    let recommendations = {};
    if (errorTypes.length > 0) {
      try {
        const [recRows] = await pool.execute(
          `SELECT error_type, recommendation, has_solution, solution_details
           FROM error_recommendations
           WHERE is_active = 1 AND error_type IN (${errorTypes.map(() => '?').join(',')})
           ORDER BY priority DESC`,
          errorTypes
        );
        recommendations = recRows.reduce((acc, rec) => {
          acc[rec.error_type] = rec;
          return acc;
        }, {});
      } catch (recommendationError) {
        logger.warn({ event: 'top_errors_recommendations_unavailable', error: recommendationError.message });
      }
    }

    // Transformer pour le frontend avec indicateurs visuels et suggestions
    const formatted = errorGroups.map((group, index) => {
      const recommendation = recommendations[group.error_type];
      const hasRecommendation = !!recommendation;
      const hasKnownSolution = recommendation && recommendation.has_solution;
      
      return {
        rank: index + 1,
        id: group.id,
        fingerprint: group.fingerprint,
        title: group.title || 'Erreur inconnue',
        errorType: group.error_type,
        eventType: group.event_type,
        severity: group.severity_max || 'ERROR',
        // 🔴 COMPTEUR EN ROUGE - nombre d'occurrences
        occurrenceCount: {
          value: Number(group.occurrence_count),
          display: `🔴 ${group.occurrence_count}`, // Rouge avec badge
          color: group.occurrence_count > 100 ? '#d32f2f' : group.occurrence_count > 50 ? '#f57c00' : '#fbc02d'
        },
        recentCount: Number(group.recent_count || 0),
        firstSeen: group.first_seen,
        lastSeen: group.last_seen,
        mostRecent: group.most_recent,
        status: group.status || 'open',
        returnCount: Number(group.return_count || 0),
        returnedAt: group.returned_at,
        sourceServer: group.source_server,
        service: group.service,
        sample_log_id: group.sample_log_id,
        affectedModules: group.affected_modules ? group.affected_modules.split(',') : [],
        // Indicateurs de performance
        trend: group.recent_count > group.occurrence_count * 0.1 ? 'increasing' : 'stable',
        urgency: group.occurrence_count > 100 ? 'critical' : group.occurrence_count > 50 ? 'high' : 'medium',
        // Suggestions et solutions
        suggestion: hasRecommendation ? (hasKnownSolution ? recommendation.solution_details : recommendation.recommendation) : null,
        hasKnownSolution: hasKnownSolution,
        solutionApplied: null,
        solutionAppliedAt: null
      };
    });

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      totalGroups: formatted.length,
      data: formatted,
      summary: {
        criticalCount: formatted.filter(g => g.urgency === 'critical').length,
        highCount: formatted.filter(g => g.urgency === 'high').length,
        totalOccurrences: formatted.reduce((sum, g) => sum + g.occurrenceCount.value, 0)
      },
      filters: { timeRange, severity, search }
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
