import { Router } from 'express';
import pool from '../../config/database.js';
import { requireAuth, userScope } from '../../middleware/auth.js';
import logger from '../../config/logger.js';
import { searchLimiter } from '../../lib/rateLimiter.js';

const router = Router();
router.use(requireAuth);
router.use(searchLimiter);

const LOG_SEARCH_SELECT = `
  id, timestamp, event_timestamp, imported_at, log_level, source, source_server, service,
  message, normalized_message, event_type, fingerprint, module, error_type,
  stack_trace, target_user, log_user,
  COALESCE(log_source, source) AS log_source,
  COALESCE(source_system, log_source, source) AS source_system,
  COALESCE(main_service, service) AS main_service,
  COALESCE(hostname, source_server) AS hostname,
  file_name, import_job_id, parser_format, timestamp_inferred, classification_confidence, created_time
`.replace(/\s+/g, ' ').trim();

const LOG_SEARCH_SELECT_MIN = `
  id, timestamp, imported_at, log_level, source, source_server, service,
  message, normalized_message, event_type, fingerprint, module, error_type,
  stack_trace, target_user, log_user, file_name, import_job_id
`.replace(/\s+/g, ' ').trim();

function appendTextSearch(whereConditions, params, query) {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length < 4) {
    whereConditions.push('(message LIKE ? OR normalized_message LIKE ?)');
    const like = '%' + trimmedQuery + '%';
    params.push(like, like);
    return;
  }
  whereConditions.push('MATCH(message, normalized_message) AGAINST(? IN BOOLEAN MODE)');
  params.push(trimmedQuery);
}

function applySearchFallback(whereClause, params) {
  let fbWhere = whereClause;
  let fbParams = [...params];
  if (fbWhere.includes('MATCH(message, normalized_message)')) {
    fbWhere = fbWhere.replace(
      'MATCH(message, normalized_message) AGAINST(? IN BOOLEAN MODE)',
      '(message LIKE ? OR normalized_message LIKE ?)'
    );
    const q = fbParams.pop();
    fbParams.push('%' + q + '%', '%' + q + '%');
  }
  return { fbWhere, fbParams };
}

function isSearchSchemaError(err) {
  return /Unknown column|FULLTEXT/i.test(err?.message || '');
}

async function runCountQuery(whereClause, params) {
  try {
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM logs WHERE ${whereClause}`,
      params
    );
    return countResult[0]?.total || 0;
  } catch (e) {
    if (!isSearchSchemaError(e)) throw e;
    const { fbWhere, fbParams } = applySearchFallback(whereClause, params);
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM logs WHERE ${fbWhere}`,
      fbParams
    );
    return countResult[0]?.total || 0;
  }
}

async function runFacetQuery(sql, params, whereClause) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (e) {
    if (!isSearchSchemaError(e)) throw e;
    const { fbWhere, fbParams } = applySearchFallback(whereClause, params);
    const fbSql = sql.replace(whereClause, fbWhere);
    const [rows] = await pool.query(fbSql, fbParams);
    return rows;
  }
}

async function runLogsSearch(whereClause, params, limitNum, offsetNum) {
  const orderBy = 'COALESCE(event_timestamp, timestamp, imported_at) DESC';
  const fullSql = `SELECT ${LOG_SEARCH_SELECT} FROM logs WHERE ${whereClause} ORDER BY ${orderBy} LIMIT ${limitNum} OFFSET ${offsetNum}`;
  try {
    const [logs] = await pool.query(fullSql, params);
    return logs;
  } catch (e) {
    if (!isSearchSchemaError(e)) throw e;
    logger.warn({ event: 'search_fallback', error: e.message }, '[API]');
    const { fbWhere, fbParams } = applySearchFallback(whereClause, params);
    const [logs] = await pool.query(
      `SELECT ${LOG_SEARCH_SELECT_MIN} FROM logs WHERE ${fbWhere} ORDER BY timestamp DESC LIMIT ${limitNum} OFFSET ${offsetNum}`,
      fbParams
    );
    return logs.map(row => ({
      ...row,
      log_source: row.source,
      source_system: row.source,
      main_service: row.service,
      hostname: row.source_server
    }));
  }
}

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
      source_system = null,
      main_service = null,
      hostname = null,
      target_user = null,
      fingerprint = null,
      from_timestamp = null,
      to_timestamp = null,
      from_imported_at = null,
      to_imported_at = null,
      limit = 50,
      offset = 0
    } = req.query;

    const limitNum = Math.min(parseInt(limit) || 50, 100);
    const offsetNum = Math.max(parseInt(offset) || 0, 0);

    if (query && query.length > 500) {
      return res.status(400).json({ error: 'Longueur mot-clé: 1-500 caractères' });
    }

    if (from_timestamp && to_timestamp && new Date(from_timestamp) > new Date(to_timestamp)) {
      return res.status(400).json({ error: 'Date de fin doit être après date de début' });
    }

    let whereConditions = ['1=1'];
    let params = [];

    // AMÉLIORATION 1: User scope (S-03 & S-07 multi-tenant)
    // FIX #9: Normalized scope handling - userScope now returns '' for admin, ' AND user_id = ?' for users
    if (scope.sql) {
      whereConditions.push(scope.sql.trim().replace(/^AND\s+/i, ''));
      params.push(...scope.params);
    }

    // Filtres texte avec FULLTEXT (P-03) + fallback LIKE
    if (query && query.trim().length > 0) {
      appendTextSearch(whereConditions, params, query);
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
    } else if (main_service) {
      whereConditions.push('service = ?');
      params.push(main_service);
    }

    if (module) {
      whereConditions.push('module = ?');
      params.push(module);
    }

    if (source_server) {
      whereConditions.push('source_server = ?');
      params.push(source_server);
    } else if (hostname) {
      whereConditions.push('source_server = ?');
      params.push(hostname);
    }

    if (source_system) {
      whereConditions.push('source = ?');
      params.push(source_system);
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

    if (from_imported_at) {
      const ts = normalizeTimestamp(from_imported_at);
      whereConditions.push('imported_at >= ?');
      params.push(ts);
    }

    if (to_imported_at) {
      const ts = normalizeTimestamp(to_imported_at);
      whereConditions.push('imported_at <= ?');
      params.push(ts);
    }

    const whereClause = whereConditions.join(' AND ');

    const totalCount = await runCountQuery(whereClause, params);

    if (totalCount > 10000) {
      return res.status(422).json({
        error: 'Trop de résultats (10K max). Affinez votre recherche.',
        count: totalCount,
      });
    }

    const logs = await runLogsSearch(whereClause, params, limitNum, offsetNum);

    const facetsLevel = await runFacetQuery(
      `SELECT log_level AS facet_key, COUNT(*) AS cnt FROM logs WHERE ${whereClause} GROUP BY log_level`,
      params,
      whereClause
    );
    const facetsEType = await runFacetQuery(
      `SELECT CONCAT('error_type:', error_type) AS facet_key, COUNT(*) AS cnt
       FROM logs WHERE ${whereClause} AND error_type IS NOT NULL GROUP BY error_type LIMIT 20`,
      params,
      whereClause
    );
    const facetsSvc = await runFacetQuery(
      `SELECT CONCAT('service:', service) AS facet_key, COUNT(*) AS cnt
       FROM logs WHERE ${whereClause} AND service IS NOT NULL GROUP BY service LIMIT 20`,
      params,
      whereClause
    );
    const facetsMod = await runFacetQuery(
      `SELECT CONCAT('module:', module) AS facet_key, COUNT(*) AS cnt
       FROM logs WHERE ${whereClause} AND module IS NOT NULL GROUP BY module LIMIT 20`,
      params,
      whereClause
    );
    const facetMap = {};
    for (const row of [...facetsLevel, ...facetsEType, ...facetsSvc, ...facetsMod]) {
      if (row.facet_key) facetMap[row.facet_key] = Number(row.cnt);
    }

    // [FIX-20] Masquer stack_trace pour les utilisateurs non-admins — peut contenir des chemins système internes
    const isAdmin = req.session?.user?.role === 'admin';
    const sanitizedLogs = isAdmin ? logs : logs.map(log => ({ ...log, stack_trace: undefined }));

    res.json({
      logs: sanitizedLogs,
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

    const limitNum = Math.min(parseInt(limit) || 50, 100);
    const offsetNum = Math.max(parseInt(offset) || 0, 0);

    let whereConditions = ['1=1'];
    let params = [];

    if (scope.sql) {
      whereConditions.push(scope.sql.trim().replace(/^AND\s+/i, ''));
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
      const logScope = scope.sql ? `AND ${scope.sql.replace('AND', '')}` : '';
      const [recentLogs] = await pool.execute(
        `SELECT id, timestamp, message, log_level FROM logs 
         WHERE fingerprint = ? ${logScope}
         ORDER BY timestamp DESC 
         LIMIT 3`,
        [group.fingerprint, ...(scope.params || [])]
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
    const windowHours = Math.min(parseInt(window_hours) || 24, 8760); // Augmenté à 1 an pour historique

    // Compter les logs par niveau sur la fenêtre
    const [byLevel] = await pool.execute(
      `SELECT log_level, COUNT(*) as count
       FROM logs 
       WHERE imported_at >= DATE_SUB(NOW(), INTERVAL ? HOUR) ${scope.sql || ''}
       GROUP BY log_level
       ORDER BY FIELD(log_level, 'FATAL', 'CRITICAL', 'ERROR', 'WARNING', 'INFO', 'DEBUG')`,
      [windowHours, ...(scope.params || [])]
    );

    // Top 10 erreurs par occurrence
    const [topErrors] = await pool.execute(
      `SELECT 
        fingerprint, 
        MAX(error_type) as error_type, 
        MAX(event_type) as event_type, 
        COUNT(*) as count, 
        MAX(timestamp) as lastSeen,
        MAX(message) as message,
        MAX(service) as source
       FROM logs 
       WHERE imported_at >= DATE_SUB(NOW(), INTERVAL ? HOUR) 
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
       WHERE imported_at >= DATE_SUB(NOW(), INTERVAL ? HOUR) AND service IS NOT NULL ${scope.sql || ''}
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
       WHERE imported_at >= DATE_SUB(NOW(), INTERVAL ? HOUR) AND module IS NOT NULL ${scope.sql || ''}
       GROUP BY module
       ORDER BY count DESC
       LIMIT 10`,
      [windowHours, ...(scope.params || [])]
    );

    // Ingestion throughput (basé sur imported_at pour voir les imports récents)
    const [hourly] = await pool.execute(
      `SELECT 
        DATE_FORMAT(imported_at, '%Y-%m-%d %H:00') as date, 
        COUNT(*) as count,
        COUNT(CASE WHEN log_level IN ('ERROR', 'CRITICAL', 'FATAL') THEN 1 END) as errorCount
       FROM logs 
       WHERE imported_at >= DATE_SUB(NOW(), INTERVAL ? HOUR) ${scope.sql || ''}
       GROUP BY date
       ORDER BY date DESC`,
      [windowHours, ...(scope.params || [])]
    );

    res.json({
      window_hours: windowHours,
      byLevel: byLevel,
      topErrors: topErrors,
      topServices: topServices,
      topModules: topModules,
      trends: hourly
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
  
  // FIX #7: Format DD/MM/YYYY HH:mm:ss ou DD/MM/YYYY (format français)
  const frMatch = str.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}:\d{2}(?::\d{2})?))?/);
  if (frMatch) {
    const time = frMatch[4] || '00:00:00';
    return `${frMatch[3]}-${frMatch[2]}-${frMatch[1]} ${time}`;
  }
  
  // ISO 8601 already valid
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.slice(0, 19);
  }
  
  return null;
}

export default router;