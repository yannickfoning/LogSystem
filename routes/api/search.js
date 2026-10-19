import { Router } from 'express';
import pool from '../../config/database.js';
import { requireAuth, userScope } from '../../middleware/auth.js';
import logger from '../../config/logger.js';
import { searchLimiter } from '../../lib/rateLimiter.js';

// Fonction utilitaire pour obtenir une recommandation pour un log
async function getRecommendationForLog(logId, scope) {
  try {
    const [logs] = await pool.execute(
      `SELECT id, error_type, event_type, parser_format, log_level, message, fingerprint
       FROM logs WHERE id = ?${scope.sql} LIMIT 1`,
      [logId, ...scope.params],
    );
    if (!logs.length) return null;

    const log = logs[0];
    
    // Check if already resolved
    if (log.fingerprint) {
      const [errorGroups] = await pool.execute(
        `SELECT status, solution_applied, solution_applied_at
         FROM error_groups
         WHERE fingerprint = ?${scope.sql} AND status = 'resolved'
         LIMIT 1`,
        [log.fingerprint, ...scope.params],
      );
      if (errorGroups.length > 0) {
        return {
          type: 'resolved',
          message: `Ce probleme a deja ete resolu. Solution appliquee : ${errorGroups[0].solution_applied}`,
          solution_applied: errorGroups[0].solution_applied,
          solution_applied_at: errorGroups[0].solution_applied_at
        };
      }
    }

    // Get recommendation from error_recommendations table
    const [recommendations] = await pool.execute(
      `SELECT recommendation, has_solution, solution_details
       FROM error_recommendations
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
        log.error_type || '', log.error_type || '', log.parser_format || null,
        log.event_type || '', log.event_type || '',
        log.parser_format || '', log.parser_format || '',
        log.log_level || '', log.log_level || '',
        log.error_type || '', log.error_type || '', log.parser_format || null,
        log.event_type || '', log.event_type || '',
        log.parser_format || '', log.parser_format || '',
        log.log_level || '', log.log_level || '',
      ]
    );

    if (recommendations.length > 0) {
      return {
        type: 'recommendation',
        message: recommendations[0].recommendation,
        has_solution: recommendations[0].has_solution,
        solution_details: recommendations[0].solution_details
      };
    }

    // Generate generic advice based on error type and target user
    const errorType = String(log.error_type || '').toLowerCase();
    const eventType = String(log.event_type || '').toLowerCase();
    const message = String(log.message || '').toLowerCase();
    const targetUser = log.target_user;
    const context = `${errorType} ${eventType} ${message}`;
    
    let genericAdvice = `Analysez ce log dans le contexte de votre application. Utilisateur responsable : ${targetUser}.`;
    
    if (/database|sql|query|ora-|deadlock|constraint/.test(context)) {
      genericAdvice = `Pour ce motif de base de donnees (utilisateur : ${targetUser}), verifiez la requete et ses parametres, puis controlez le schema, les droits et les verrous dans le service concerne. Verifiez aussi les permissions de l utilisateur ${targetUser} sur la base de donnees.`;
    } else if (/invalid|validation|format|parse/.test(context)) {
      genericAdvice = `Pour cette erreur de validation (utilisateur : ${targetUser}), relevez le champ et la valeur rejetes dans le message complet, comparez avec une execution reussie du meme service et corrigez le format a la source. Verifiez les donnees fournies par l utilisateur ${targetUser}.`;
    } else if (/auth|credential|permission|unauthorized|forbidden|401|403/.test(context)) {
      genericAdvice = `Pour cette erreur d acces (utilisateur : ${targetUser}), verifiez les roles et les droits du service cible. Controlez aussi l expiration des identifiants de l utilisateur ${targetUser} sans les inscrire dans les logs.`;
    } else if (/timeout|timed out|econnrefused|network|connection/.test(context)) {
      genericAdvice = `Pour cette erreur de connexion (utilisateur : ${targetUser}), verifiez l etat du service distant, son adresse et son port, puis controlez les delais d attente et les traces reseau a la meme heure. Verifiez si l utilisateur ${targetUser} a acces au service.`;
    }

    return {
      type: 'generic',
      message: genericAdvice,
      target_user: targetUser
    };
  } catch (e) {
    logger.error({ event: 'get_recommendation_error', error: e.message }, '[SEARCH]');
    return null;
  }
}

const router = Router();
router.use(requireAuth);
router.use(searchLimiter);

const LOG_SEARCH_SELECT = `
  id, timestamp, imported_at, log_level, source, source_server, source_system, log_source, service,
  message, normalized_message, event_type, fingerprint, module, error_type,
  stack_trace, target_user,
  parser_format, timestamp_inferred, classification_confidence, created_time,
  (SELECT COALESCE(NULLIF(display_name, ''), email) FROM users AS import_user WHERE import_user.id = logs.imported_by_user_id) AS importer_name,
  (SELECT filename FROM import_jobs AS source_job WHERE source_job.id = logs.import_job_id) AS import_filename
`.replace(/\s+/g, ' ').trim();

const LOG_SEARCH_SELECT_MIN = `
  id, timestamp, imported_at, log_level, source, source_server, source_system, log_source, service,
  message, normalized_message, event_type, fingerprint, module, error_type,
  stack_trace, target_user,
  (SELECT COALESCE(NULLIF(display_name, ''), email) FROM users AS import_user WHERE import_user.id = logs.imported_by_user_id) AS importer_name,
  (SELECT filename FROM import_jobs AS source_job WHERE source_job.id = logs.import_job_id) AS import_filename
`.replace(/\s+/g, ' ').trim();

const SEARCH_LIKE_COLUMNS = [
  'message', 'normalized_message', 'source', 'source_server', 'source_system',
  'log_source', 'service', 'event_type', 'error_type', 'target_user', 'log_level',
  'CAST(timestamp AS CHAR)', 'CAST(imported_at AS CHAR)',
  "DATE_FORMAT(timestamp, '%d/%m/%Y')", "DATE_FORMAT(imported_at, '%d/%m/%Y')",
];

function buildLiteralSearch(terms) {
  const likeClauses = [];
  const likeParams = [];
  for (const term of terms) {
    const escapedTerm = String(term).replace(/[\\%_]/g, '\\$&');
    const pattern = `%${escapedTerm}%`;
    likeClauses.push(`(${SEARCH_LIKE_COLUMNS.map(column => `${column} LIKE ?`).join(' OR ')})`);
    likeParams.push(...SEARCH_LIKE_COLUMNS.map(() => pattern));
  }
  return {
    sql: likeClauses.length ? `(${likeClauses.join(' AND ')})` : '(1 = 0)',
    params: likeParams,
  };
}

function appendTextSearch(whereConditions, params, query) {
  const trimmedQuery = query.trim();
  if (trimmedQuery.includes('+')) {
    const terms = trimmedQuery.split(/\s*\+\s*/).map(term => term.trim()).filter(Boolean);
    const literal = buildLiteralSearch(terms);
    whereConditions.push(literal.sql);
    params.push(...literal.params);
    return;
  }

  if (trimmedQuery.length < 4) {
    const literal = buildLiteralSearch([trimmedQuery]);
    whereConditions.push(literal.sql);
    params.push(...literal.params);
    return;
  }

  const fullTextTerms = trimmedQuery.match(/[\p{L}\p{N}_]+/gu) || [];
  const booleanQuery = fullTextTerms.map(term => `+${term}*`).join(' ');
  whereConditions.push('MATCH(message, normalized_message) AGAINST(? IN BOOLEAN MODE)');
  params.push(booleanQuery);
}

function applySearchFallback(whereClause, params) {
  const matchExpression = 'MATCH(message, normalized_message) AGAINST(? IN BOOLEAN MODE)';
  const matchOffset = whereClause.indexOf(matchExpression);
  if (matchOffset === -1) return { fbWhere: whereClause, fbParams: [...params] };

  // Text-search parameters can be followed by metadata/date filters. Replace
  // the value at the SQL placeholder position so those filters stay aligned.
  const paramIndex = (whereClause.slice(0, matchOffset).match(/\?/g) || []).length;
  const query = String(params[paramIndex] ?? '');
  const terms = query.match(/[\p{L}\p{N}_]+/gu) || [];
  const fallback = buildLiteralSearch(terms);
  const fbWhere = whereClause.replace(matchExpression, fallback.sql);
  const fbParams = [...params];
  fbParams.splice(paramIndex, 1, ...fallback.params);
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
    return { total: Number(countResult[0]?.total || 0), fallbackApplied: false };
  } catch (e) {
    if (!isSearchSchemaError(e)) throw e;
    const { fbWhere, fbParams } = applySearchFallback(whereClause, params);
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM logs WHERE ${fbWhere}`,
      fbParams
    );
    return { total: Number(countResult[0]?.total || 0), fallbackApplied: true };
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
  const orderBy = 'COALESCE(timestamp, imported_at) DESC';
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
      source: row.source,
      service: row.service,
      source_server: row.source_server
    }));
  }
}

router.get('/repeated-patterns', async (req, res) => {
  try {
    const scope = userScope(req);
    const minOccurrences = Math.min(100, Math.max(2, Number.parseInt(req.query.min_occurrences, 10) || 3));
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 30));
    const [patterns] = await pool.execute(
      `SELECT fingerprint, MAX(parser_format) AS parser_format, MAX(log_level) AS log_level,
              MAX(error_type) AS error_type, MAX(event_type) AS event_type,
              MAX(service) AS service, COUNT(*) AS occurrences,
              MIN(imported_at) AS first_imported_at, MAX(imported_at) AS last_imported_at
       FROM logs
       WHERE fingerprint IS NOT NULL AND log_level IN ('ERROR','CRITICAL','FATAL')${scope.sql}
       GROUP BY fingerprint
       HAVING COUNT(*) >= ?
       ORDER BY occurrences DESC, last_imported_at DESC
       LIMIT ${limit}`,
      [...scope.params, minOccurrences],
    );
    res.json({ patterns, minimum_occurrences: minOccurrences });
  } catch (error) {
    logger.error({ event: 'repeated_patterns_error', error: error.message }, '[API]');
    res.status(500).json({ error: 'Impossible de charger les motifs récurrents' });
  }
});

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
      source = null,
      target_user = null,
      fingerprint = null,
      from_timestamp = null,
      to_timestamp = null,
      from_imported_at = null,
      to_imported_at = null,
      limit = 50,
      offset = 0
    } = req.query;

    const requestedLimit = Number.parseInt(limit, 10);
    const requestedOffset = Number.parseInt(offset, 10);
    const limitNum = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 100)
      : 50;
    const offsetNum = Number.isSafeInteger(requestedOffset) && requestedOffset >= 0
      ? requestedOffset
      : 0;

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
    }

    if (module) {
      whereConditions.push('module = ?');
      params.push(module);
    }

    if (source_server) {
      whereConditions.push('source_server = ?');
      params.push(source_server);
    }

    if (source) {
      whereConditions.push("COALESCE(NULLIF(source, ''), NULLIF(source_server, ''), NULLIF(source_system, ''), NULLIF(log_source, ''), (SELECT filename FROM import_jobs AS source_job WHERE source_job.id = logs.import_job_id)) = ?");
      params.push(source);
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

    let whereClause = whereConditions.join(' AND ');

    const countResult = await runCountQuery(whereClause, params);
    let totalCount = countResult.total;
    if (countResult.fallbackApplied) {
      const fallback = applySearchFallback(whereClause, params);
      whereClause = fallback.fbWhere;
      params = fallback.fbParams;
    } else if (query && query.trim() && totalCount === 0) {
      // FULLTEXT can miss short/stop words or values stored in log metadata.
      // Retry with a literal multi-column search only when the indexed search
      // finds nothing, keeping the common search path index-backed.
      const fallback = applySearchFallback(whereClause, params);
      if (fallback.fbWhere !== whereClause) {
        const [fallbackCount] = await pool.query(
          `SELECT COUNT(*) as total FROM logs WHERE ${fallback.fbWhere}`,
          fallback.fbParams
        );
        totalCount = Number(fallbackCount[0]?.total || 0);
        if (totalCount > 0) {
          whereClause = fallback.fbWhere;
          params = fallback.fbParams;
        }
      }
    }

    const logs = await runLogsSearch(whereClause, params, limitNum, offsetNum);

    // Ajouter des recommandations pour chaque log
    const enrichedLogs = [];
    for (const log of logs) {
      const recommendation = await getRecommendationForLog(log.id, scope);
      enrichedLogs.push({
        ...log,
        recommendation: recommendation || null
      });
    }

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
    const sanitizedLogs = isAdmin ? enrichedLogs : enrichedLogs.map(log => ({ ...log, stack_trace: undefined }));

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

    const requestedLimit = Number.parseInt(limit, 10);
    const requestedOffset = Number.parseInt(offset, 10);
    const limitNum = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 100)
      : 50;
    const offsetNum = Number.isSafeInteger(requestedOffset) && requestedOffset >= 0
      ? requestedOffset
      : 0;

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
       LIMIT ${limitNum} OFFSET ${offsetNum}`,
      params
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
      `SELECT DISTINCT service FROM logs
       WHERE service IS NOT NULL AND TRIM(service) <> ''
         AND LOWER(TRIM(service)) NOT IN ('unknown', 'inconnu', 'n/a', 'na', 'null', '-')
         ${scope.sql || ''}
       ORDER BY service LIMIT 500`,
      scope.params || []
    );

    const [modules] = await pool.execute(
      `SELECT DISTINCT module FROM logs WHERE module IS NOT NULL ${scope.sql || ''} LIMIT 100`,
      scope.params || []
    );

    const [sources] = await pool.execute(
      `SELECT DISTINCT COALESCE(NULLIF(source, ''), NULLIF(source_server, ''), NULLIF(source_system, ''), NULLIF(log_source, ''),
         (SELECT filename FROM import_jobs AS source_job WHERE source_job.id = logs.import_job_id)) AS source
       FROM logs
       WHERE COALESCE(NULLIF(source, ''), NULLIF(source_server, ''), NULLIF(source_system, ''), NULLIF(log_source, ''),
         (SELECT filename FROM import_jobs AS source_job WHERE source_job.id = logs.import_job_id)) IS NOT NULL
         AND LOWER(TRIM(COALESCE(NULLIF(source, ''), NULLIF(source_server, ''), NULLIF(source_system, ''), NULLIF(log_source, ''),
           (SELECT filename FROM import_jobs AS source_job WHERE source_job.id = logs.import_job_id)))) NOT IN ('unknown', 'inconnu', 'n/a', 'na', 'null', '-')
       ${scope.sql || ''}
       ORDER BY source LIMIT 1000`,
      scope.params || []
    );

    const [errorTypes] = await pool.execute(
      `SELECT DISTINCT error_type FROM logs WHERE error_type IS NOT NULL ${scope.sql || ''} LIMIT 100`,
      scope.params || []
    );

    const [users] = await pool.execute(
      `SELECT DISTINCT target_user FROM logs
       WHERE target_user IS NOT NULL AND TRIM(target_user) <> ''
         AND LOWER(TRIM(target_user)) NOT IN ('unknown', 'inconnu', 'n/a', 'na', 'null', '-')
         ${scope.sql || ''}
       ORDER BY target_user LIMIT 500`,
      scope.params || []
    );

    res.json({
      services: services.map(r => r.service).filter(Boolean),
      modules: modules.map(r => r.module).filter(Boolean),
      sources: sources.map(r => r.source).filter(Boolean),
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
