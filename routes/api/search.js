import { Router } from 'express';
import pool from '../../config/database.js';
import { requireAuth, userScope } from '../../middleware/auth.js';
import logger from '../../config/logger.js';

const router = Router();
router.use(requireAuth);

/**
 * GET /api/search
 * 
 * Recherche enrichie avec filtres avancés :
 * - query: texte libre (FULLTEXT search)
 * - level: DEBUG|INFO|WARNING|ERROR|CRITICAL|FATAL
 * - error_type: type d'erreur (NullPointerException, ECONNREFUSED, etc.)
 * - service: filtre par service
 * - module: filtre par module
 * - source_server: filtre par serveur source
 * - target_user: filtre par utilisateur cible
 * - fingerprint: recherche par fingerprint exact
 * - from_timestamp: ISO 8601 ou UNIX timestamp
 * - to_timestamp: ISO 8601 ou UNIX timestamp
 * - limit: 1-1000 (default 50)
 * - offset: pagination
 * 
 * Retourne: { logs, total_count, facets }
 */
router.get('/', async (req, res) => {
  try {
    const scope = userScope(req);
    const {
      query = '',
      level = null,
      error_type = null,
      service = null,
      module = null,
      source_server = null,
      target_user = null,
      fingerprint = null,
      from_timestamp = null,
      to_timestamp = null,
      limit = 50,
      offset = 0
    } = req.query;

    const limitNum = Math.min(parseInt(limit) || 50, 1000);
    const offsetNum = Math.max(parseInt(offset) || 0, 0);

    let whereConditions = ['1=1'];
    let params = [];

    // AMÉLIORATION 1: User scope (S-03 & S-07 multi-tenant)
    if (scope.sql) {
      whereConditions.push(scope.sql.replace(/AND\s*/, ''));
      params.push(...scope.params);
    }

    // Filtres texte avec FULLTEXT (P-03)
    if (query && query.trim().length > 0) {
      whereConditions.push('MATCH(message, normalized_message) AGAINST(? IN BOOLEAN MODE)');
      params.push(query.trim());
    }

    // Filtres métadonnées
    if (level) {
      whereConditions.push('log_level = ?');
      params.push(level.toUpperCase());
    }

    if (error_type) {
      whereConditions.push('error_type = ?');
      params.push(error_type);
    }

    if (service) {
      whereConditions.push('service = ?');
      params.push(service);
    }

    if (module) {
      whereConditions.push('module = ?');
      params.push(module);
    }

    if (source_server) {
      whereConditions.push('source_server = ?');
      params.push(source_server);
    }

    if (target_user) {
      whereConditions.push('target_user = ?');
      params.push(target_user);
    }

    if (fingerprint) {
      whereConditions.push('fingerprint = ?');
      params.push(fingerprint);
    }

    // Filtres timestamps (P-05: Index composite user_ts, user_level_ts, etc.)
    if (from_timestamp) {
      const ts = normalizeTimestamp(from_timestamp);
      whereConditions.push('timestamp >= ?');
      params.push(ts);
    }

    if (to_timestamp) {
      const ts = normalizeTimestamp(to_timestamp);
      whereConditions.push('timestamp <= ?');
      params.push(ts);
    }

    const whereClause = whereConditions.join(' AND ');

    // Compter le total
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM logs WHERE ${whereClause}`,
      params
    );
    const totalCount = countResult[0]?.total || 0;

    // Fetch logs avec pagination
    const [logs] = await pool.execute(
      `SELECT 
        id, timestamp, created_time, log_level, source, source_server, service, 
        message, normalized_message, event_type, fingerprint, module, error_type,
        stack_trace, target_user, parser_format, timestamp_inferred, 
        classification_confidence
       FROM logs 
       WHERE ${whereClause}
       ORDER BY timestamp DESC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offsetNum]
    );

    // Calculer les facets (dimensions disponibles pour raffiner la recherche)
    const [facets] = await pool.execute(
      `SELECT 
        log_level, COUNT(*) as count
       FROM logs 
       WHERE ${whereClause}
       GROUP BY log_level
       UNION ALL
       SELECT CONCAT('error_type:', COALESCE(error_type, 'unknown')), COUNT(*) 
       FROM logs 
       WHERE ${whereClause} AND error_type IS NOT NULL
       GROUP BY error_type
       UNION ALL
       SELECT CONCAT('service:', service), COUNT(*) 
       FROM logs 
       WHERE ${whereClause} AND service IS NOT NULL
       GROUP BY service
       UNION ALL
       SELECT CONCAT('module:', module), COUNT(*) 
       FROM logs 
       WHERE ${whereClause} AND module IS NOT NULL
       GROUP BY module
       LIMIT 50`,
      params
    );

    // Format facets
    const facetMap = {};
    for (const row of facets) {
      const key = row.log_level || row['CONCAT(\'error_type:\', COALESCE(error_type, \'unknown\'))'] ||
                  row['CONCAT(\'service:\', service)'] || row['CONCAT(\'module:\', module)'];
      const count = row.count || row['COUNT(*)'];
      if (key) facetMap[key] = count;
    }

    res.json({
      logs,
      total_count: totalCount,
      limit: limitNum,
      offset: offsetNum,
      facets: facetMap
    });
  } catch (e) {
    logger.error({ event: 'search_error', error: e.message }, '[API]');
    res.status(500).json({ error: 'Erreur lors de la recherche' });
  }
});

/**
 * GET /api/search/error-directory
 * 
 * Répertoire des erreurs avec agrégations et statuts
 * Retourne les error_groups avec counts, retours détectés, etc.
 */
router.get('/error-directory', async (req, res) => {
  try {
    const scope = userScope(req);
    const {
      status = null, // open|resolved|returned
      limit = 50,
      offset = 0
    } = req.query;

    const limitNum = Math.min(parseInt(limit) || 50, 1000);
    const offsetNum = Math.max(parseInt(offset) || 0, 0);

    let whereConditions = ['1=1'];
    let params = [];

    if (scope.sql) {
      whereConditions.push(scope.sql.replace(/AND\s*/, ''));
      params.push(...scope.params);
    }

    if (status && ['open', 'resolved', 'returned'].includes(status)) {
      whereConditions.push('status = ?');
      params.push(status);
    }

    const whereClause = whereConditions.join(' AND ');

    // Compter le total
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM error_groups WHERE ${whereClause}`,
      params
    );
    const totalCount = countResult[0]?.total || 0;

    // Fetch error groups avec contexte
    const [groups] = await pool.execute(
      `SELECT 
        id, fingerprint, title, event_type, severity_max, occurrence_count,
        first_seen, last_seen, previous_seen, resolved_at, returned_at, return_count,
        return_reason, source_server, service, error_type, status
       FROM error_groups 
       WHERE ${whereClause}
       ORDER BY last_seen DESC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offsetNum]
    );

    // Enrichir avec logs récents et tendances
    const enriched = [];
    for (const group of groups) {
      // Logs récents pour ce fingerprint
      const [recentLogs] = await pool.execute(
        `SELECT id, timestamp, message, log_level FROM logs 
         WHERE fingerprint = ? AND user_id = ? 
         ORDER BY timestamp DESC 
         LIMIT 3`,
        [group.fingerprint, req.session.user.id]
      );

      enriched.push({
        ...group,
        recent_logs: recentLogs,
        days_since_last_seen: group.last_seen 
          ? Math.floor((Date.now() - new Date(group.last_seen).getTime()) / (24 * 60 * 60 * 1000))
          : null,
        is_returning: group.status === 'returned'
      });
    }

    res.json({
      error_groups: enriched,
      total_count: totalCount,
      limit: limitNum,
      offset: offsetNum
    });
  } catch (e) {
    logger.error({ event: 'error_directory_error', error: e.message }, '[API]');
    res.status(500).json({ error: 'Erreur lors de la récupération du répertoire des erreurs' });
  }
});

/**
 * GET /api/search/trends
 * 
 * Tendances temporelles pour dashboard
 * - Compte logs par niveau sur les dernières heures/jours
 * - Top erreurs par occurrence et sévérité
 * - Services/modules les plus actifs
 */
router.get('/trends', async (req, res) => {
  try {
    const scope = userScope(req);
    const { window_hours = 24 } = req.query;
    const windowHours = Math.min(parseInt(window_hours) || 24, 720); // max 30 jours

    // Compter les logs par niveau sur la fenêtre
    const [byLevel] = await pool.execute(
      `SELECT log_level, COUNT(*) as count
       FROM logs 
       WHERE timestamp >= DATE_SUB(NOW(), INTERVAL ? HOUR) ${scope.sql || ''}
       GROUP BY log_level
       ORDER BY FIELD(log_level, 'FATAL', 'CRITICAL', 'ERROR', 'WARNING', 'INFO', 'DEBUG')`,
      [windowHours, ...(scope.params || [])]
    );

    // Top 10 erreurs par occurrence
    const [topErrors] = await pool.execute(
      `SELECT fingerprint, error_type, event_type, COUNT(*) as count, MAX(timestamp) as last_seen
       FROM logs 
       WHERE timestamp >= DATE_SUB(NOW(), INTERVAL ? HOUR) 
         AND log_level IN ('ERROR', 'CRITICAL', 'FATAL') ${scope.sql || ''}
       GROUP BY fingerprint
       ORDER BY count DESC
       LIMIT 10`,
      [windowHours, ...(scope.params || [])]
    );

    // Top services
    const [topServices] = await pool.execute(
      `SELECT service, COUNT(*) as count, 
              COUNT(CASE WHEN log_level IN ('ERROR', 'CRITICAL', 'FATAL') THEN 1 END) as error_count
       FROM logs 
       WHERE timestamp >= DATE_SUB(NOW(), INTERVAL ? HOUR) AND service IS NOT NULL ${scope.sql || ''}
       GROUP BY service
       ORDER BY count DESC
       LIMIT 10`,
      [windowHours, ...(scope.params || [])]
    );

    // Top modules
    const [topModules] = await pool.execute(
      `SELECT module, COUNT(*) as count, 
              COUNT(CASE WHEN log_level IN ('ERROR', 'CRITICAL', 'FATAL') THEN 1 END) as error_count
       FROM logs 
       WHERE timestamp >= DATE_SUB(NOW(), INTERVAL ? HOUR) AND module IS NOT NULL ${scope.sql || ''}
       GROUP BY module
       ORDER BY count DESC
       LIMIT 10`,
      [windowHours, ...(scope.params || [])]
    );

    // Hourly throughput (dernières 24h)
    const [hourly] = await pool.execute(
      `SELECT DATE_FORMAT(timestamp, '%Y-%m-%d %H:00') as hour, COUNT(*) as count
       FROM logs 
       WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 24 HOUR) ${scope.sql || ''}
       GROUP BY DATE_FORMAT(timestamp, '%Y-%m-%d %H:00')
       ORDER BY hour DESC`,
      scope.params || []
    );

    res.json({
      window_hours: windowHours,
      by_level: byLevel,
      top_errors: topErrors,
      top_services: topServices,
      top_modules: topModules,
      hourly_throughput: hourly
    });
  } catch (e) {
    logger.error({ event: 'trends_error', error: e.message }, '[API]');
    res.status(500).json({ error: 'Erreur lors du calcul des tendances' });
  }
});

/**
 * GET /api/search/metadata
 * 
 * Récupère les vocabulaires uniques pour les filtres (autocomplete)
 * - services, modules, sources, error_types, utilisateurs
 */
router.get('/metadata', async (req, res) => {
  try {
    const scope = userScope(req);

    const [services] = await pool.execute(
      `SELECT DISTINCT service FROM logs WHERE service IS NOT NULL ${scope.sql || ''} LIMIT 100`,
      scope.params || []
    );

    const [modules] = await pool.execute(
      `SELECT DISTINCT module FROM logs WHERE module IS NOT NULL ${scope.sql || ''} LIMIT 100`,
      scope.params || []
    );

    const [sources] = await pool.execute(
      `SELECT DISTINCT source_server FROM logs WHERE source_server IS NOT NULL ${scope.sql || ''} LIMIT 100`,
      scope.params || []
    );

    const [errorTypes] = await pool.execute(
      `SELECT DISTINCT error_type FROM logs WHERE error_type IS NOT NULL ${scope.sql || ''} LIMIT 100`,
      scope.params || []
    );

    const [users] = await pool.execute(
      `SELECT DISTINCT target_user FROM logs WHERE target_user IS NOT NULL ${scope.sql || ''} LIMIT 100`,
      scope.params || []
    );

    res.json({
      services: services.map(r => r.service).filter(Boolean),
      modules: modules.map(r => r.module).filter(Boolean),
      sources: sources.map(r => r.source_server).filter(Boolean),
      error_types: errorTypes.map(r => r.error_type).filter(Boolean),
      target_users: users.map(r => r.target_user).filter(Boolean)
    });
  } catch (e) {
    logger.error({ event: 'metadata_error', error: e.message }, '[API]');
    res.status(500).json({ error: 'Erreur lors de la récupération des métadonnées' });
  }
});

function normalizeTimestamp(ts) {
  if (!ts) return null;
  const str = String(ts).trim();
  
  // UNIX timestamp (10-13 digits)
  if (/^\d{10,13}$/.test(str)) {
    return new Date(parseInt(str) * (str.length === 10 ? 1000 : 1)).toISOString().slice(0, 19).replace('T', ' ');
  }
  
  // ISO 8601 already valid
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.slice(0, 19);
  }
  
  return null;
}

export default router;
