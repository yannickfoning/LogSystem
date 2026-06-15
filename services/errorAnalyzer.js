/**
 * Error Analysis Service - AMÉLIORATION 6
 * Provides intelligent error analysis and correction suggestions
 */

import logger from '../config/logger.js';
import pool from '../config/database.js';

/**
 * Analyze a group of similar errors and return a detailed report
 */
export async function analyzeErrorGroup(fingerprint, userId) {
  try {
    if (!userId) {
      logger.error({ event: 'security_violation', reason: 'Missing userId in analyzeErrorGroup' }, '[ERROR ANALYZER]');
      return null;
    }

    // Get group statistics
    const [groups] = await pool.execute(
      `SELECT fingerprint, COUNT(*) as occurrence_count, 
              MIN(timestamp) as first_seen, MAX(timestamp) as last_seen,
              MAX(log_level) as max_severity
       FROM logs 
       WHERE fingerprint = ? AND user_id = ?
       GROUP BY fingerprint`,
      [fingerprint, userId]
    );
    
    if (groups.length === 0) {
      return null;
    }
    
    // AMÉLIORATION : Parallélisation des requêtes pour réduire la latence
    const [affectedRows, sampleRows] = await Promise.all([
      pool.execute(
        `SELECT DISTINCT module, target_user, error_type, event_type
         FROM logs 
         WHERE fingerprint = ? AND user_id = ?`,
        [fingerprint, userId]
      ),
      pool.execute(
        `SELECT message, stack_trace, timestamp FROM logs 
         WHERE fingerprint = ? AND user_id = ?
         ORDER BY timestamp DESC LIMIT 3`,
        [fingerprint, userId]
      )
    ]);

    const group = groups[0];
    const affected = affectedRows[0];
    const samples = sampleRows[0];

    const modules = [...new Set(affected.map(a => a.module).filter(Boolean))];
    const users = [...new Set(affected.map(a => a.target_user).filter(Boolean))];
    const errorType = affected[0]?.error_type || null;
    
    const suggestion = suggestFix(errorType, samples[0]?.message, samples[0]?.stack_trace);
    
    return {
      fingerprint,
      occurrence_count: group.occurrence_count,
      first_seen: group.first_seen,
      last_seen: group.last_seen,
      affected_modules: modules,
      affected_users: users,
      max_severity: group.max_severity,
      error_type: errorType,
      suggestion: suggestion,
      samples: samples
    };
  } catch (e) {
    logger.error({ event: 'error_analysis_failed', error: e.message }, '[ERROR ANALYZER]');
    return null;
  }
}

/**
 * Detect recurring patterns in user's logs over a time window
 */
export async function detectRecurringPatterns(userId, windowHours = 24) {
  try {
    if (!userId) {
      logger.error({ event: 'security_violation', reason: 'Missing userId in detectRecurringPatterns' }, '[PATTERN DETECTION]');
      return [];
    }

    const windowStart = new Date(Date.now() - windowHours * 3600000);
    
    // Get most frequent fingerprints in the window
    const [patterns] = await pool.execute(
      `SELECT fingerprint, COUNT(*) as count, MAX(log_level) as max_level, 
              MAX(timestamp) as last_seen
       FROM logs 
       WHERE user_id = ? AND timestamp >= ? 
       AND log_level IN ('ERROR', 'CRITICAL', 'FATAL')
       GROUP BY fingerprint
       ORDER BY count DESC
       LIMIT 10`,
      [userId, windowStart]
    );
    
    if (patterns.length === 0) return [];

    // FIX: Optimized to fetch details for all fingerprints in one query
    const fingerprints = patterns.map(p => p.fingerprint);
    const [allDetails] = await pool.execute(
      `SELECT fingerprint, module, error_type 
       FROM logs 
       WHERE user_id = ? AND fingerprint IN (${fingerprints.map(() => '?').join(',')})
       GROUP BY fingerprint, module, error_type`,
      [userId, ...fingerprints]
    );

    // Group details by fingerprint
    const enriched = [];
    for (const pattern of patterns) {
      const details = allDetails.filter(d => d.fingerprint === pattern.fingerprint);
      
      enriched.push({
        ...pattern,
        affected_modules: [...new Set(details.map(d => d.module).filter(Boolean))],
        error_type: details[0]?.error_type,
        suggestion: suggestFix(details[0]?.error_type, null, null)
      });
    }
    
    return enriched;
  } catch (e) {
    logger.error({ event: 'pattern_detection_failed', error: e.message }, '[PATTERN DETECTION]');
    return [];
  }
}

/**
 * Suggest a fix based on error type and message
 */
export function suggestFix(errorType, message, stackTrace) {
  const msg = String(message || '').toLowerCase();
  const stack = String(stackTrace || '').toLowerCase();
  const err = String(errorType || '').toUpperCase();
  
  // AMÉLIORATION 6: Comprehensive error handling suggestions
  const fixMap = {
    'ECONNREFUSED': {
      title: 'Erreur de connexion refusée',
      suggestion: 'Le service cible n\'écoute pas sur le port indiqué ou est arrêté.',
      steps: [
        'Vérifiez que le service est démarré',
        'Vérifiez le numéro de port',
        'Vérifiez la disponibilité réseau',
        'Vérifiez les pare-feu'
      ]
    },
    'ETIMEDOUT': {
      title: 'Délai d\'expiration dépassé',
      suggestion: 'La connexion a pris trop de temps pour établir ou répondre.',
      steps: [
        'Augmentez le timeout dans la configuration',
        'Vérifiez la latence réseau',
        'Vérifiez si le serveur surchargé',
        'Vérifiez la bande passante réseau'
      ]
    },
    'ENOENT': {
      title: 'Fichier ou répertoire introuvable',
      suggestion: 'Le chemin fourni n\'existe pas ou les permissions d\'accès sont insuffisantes.',
      steps: [
        'Vérifiez le chemin du fichier/répertoire',
        'Vérifiez que le fichier existe',
        'Vérifiez les permissions d\'accès',
        'Vérifiez les variables d\'environnement'
      ]
    },
    'ER_ACCESS_DENIED_ERROR': {
      title: 'Accès à la base de données refusé',
      suggestion: 'Les identifiants de connexion sont incorrects ou l\'utilisateur n\'a pas les permissions.',
      steps: [
        'Vérifiez DB_USER et DB_PASSWORD',
        'Vérifiez que l\'utilisateur existe en base',
        'Vérifiez les permissions de l\'utilisateur',
        'Vérifiez la cible (host:port) de la base de données'
      ]
    },
    'SYNTAXERROR': {
      title: 'Erreur de syntaxe',
      suggestion: 'Votre code contient une erreur de syntaxe qui empêche son exécution.',
      steps: [
        'Consultez la ligne indiquée dans la stack trace',
        'Vérifiez les accolades, parenthèses, points-virgules',
        'Utilisez un linter (ESLint pour JS, Pylint pour Python)',
        'Utilisez un validateur syntaxique en ligne'
      ]
    },
    'TYPEERROR': {
      title: 'Erreur de type',
      suggestion: 'Une opération est tentée sur un type de données inapproprié ou null/undefined.',
      steps: [
        'Ajoutez des vérifications null/undefined',
        'Vérifiez les types des variables',
        'Utilisez typeof pour valider les types',
        'Activez strict mode (\'use strict\')'
      ]
    },
    'REFERENCEERROR': {
      title: 'Variable non définie',
      suggestion: 'Une variable ou fonction référencée n\'existe pas ou est hors de portée.',
      steps: [
        'Vérifiez l\'orthographe de la variable',
        'Vérifiez que la variable est déclarée',
        'Vérifiez la portée (scope) de la variable',
        'Vérifiez les imports/requires'
      ]
    },
    'RANGEERROR': {
      title: 'Valeur hors limites',
      suggestion: 'Une valeur fournie est en dehors de la plage acceptable.',
      steps: [
        'Vérifiez les limites acceptées',
        'Validez les entrées utilisateur',
        'Ajoutez des vérifications de limite',
        'Utilisez parseInt/parseFloat avec validation'
      ]
    }
  };
  
  // Check error type first
  if (fixMap[err]) {
    return fixMap[err].suggestion;
  }
  
  // Check message patterns for common issues
  if (msg.includes('401') || msg.includes('unauthorized')) {
    return 'Erreur d\'authentification (401). Vérifiez vos tokens JWT, cookies de session et identifiants.';
  }
  
  if (msg.includes('403') || msg.includes('forbidden')) {
    return 'Erreur d\'autorisation (403). Vérifiez vos droits d\'accès et permissions pour cette ressource.';
  }
  
  if (msg.includes('404') || msg.includes('not found')) {
    return 'Ressource non trouvée (404). Vérifiez l\'URL et que la ressource existe bien.';
  }
  
  if (msg.includes('500') || msg.includes('internal server')) {
    return 'Erreur serveur interne (500). Consultez les logs du serveur pour identifier le problème.';
  }
  
  if (msg.includes('cannot read') || msg.includes('cannot set')) {
    return 'Tentative d\'accès à une propriété sur null/undefined. Ajoutez une vérification (if (obj) ou obj?.prop).';
  }
  
  if (msg.includes('out of memory') || msg.includes('heap')) {
    return 'Mémoire insuffisante (OOM). Vérifiez les fuites mémoire ou augmentez --max-old-space-size pour Node.js.';
  }
  
  if (msg.includes('deadlock')) {
    return 'Deadlock détecté en base de données. Revisitez l\'ordre des transactions et les verrous.';
  }
  
  if (msg.includes('missing_user') || msg.includes('missing_module')) {
    return 'Le parseur n\'a pas pu extraire les métadonnées. Vérifiez le format source ou la configuration du parser_format.';
  }
  if (msg.includes('connection limit exceeded')) {
    return 'La base de données a atteint sa limite de connexions. Augmentez DB_CONNECTION_LIMIT ou optimisez l\'utilisation des connexions.';
  }
  if (msg.includes('duplicate entry') || msg.includes('unique constraint')) {
    return 'Violation de contrainte UNIQUE en base de données. Vérifiez les doublons et les valeurs uniques.';
  }
  
  if (msg.includes('foreign key') || msg.includes('constraint')) {
    return 'Violation de contrainte de clé étrangère. Vérifiez que les IDs référencés existent.';
  }
  
  if (msg.includes('json') && msg.includes('parse')) {
    return 'Erreur de parsing JSON. Vérifiez que le JSON est valide (pas de virgules manquantes, guillemets mal échappés, etc.).';
  }
  
  if (msg.includes('timeout')) {
    return 'Opération expirée. Augmentez le timeout ou optimisez la requête/opération.';
  }
  
  // Default suggestion
  return 'Aucune suggestion automatique disponible. Consultez la documentation du module ou cherchez l\'erreur exacte dans la communauté.';
}

/**
 * Get detailed error info for display
 */
export function getErrorInfo(errorType, message) {
  const info = {
    type: errorType || 'Unknown',
    message: message || 'No message',
    severity: 'medium',
    category: 'generic'
  };
  
  // Classify by severity
  const err = String(errorType || '').toUpperCase();
  if (['FATAL', 'CRITICAL', 'ECONNREFUSED', 'ETIMEDOUT', 'ER_ACCESS_DENIED'].includes(err)) {
    info.severity = 'critical';
  } else if (['ERROR', 'SYNTAXERROR', 'TYPEERROR'].includes(err)) {
    info.severity = 'high';
  } else if (['WARNING', 'REFERENCEERROR'].includes(err)) {
    info.severity = 'medium';
  } else {
    info.severity = 'low';
  }
  
  // Classify by category
  if (err.includes('ECONN') || err.includes('ETIMEDOUT')) {
    info.category = 'network';
  } else if (err.includes('ENOENT') || err.includes('ACCESS')) {
    info.category = 'filesystem';
  } else if (err.includes('ER_') || err.includes('CONSTRAINT')) {
    info.category = 'database';
  } else if (err.includes('SYNTAX') || err.includes('TYPE') || err.includes('REFERENCE')) {
    info.category = 'code';
  } else if (err.includes('401') || err.includes('403')) {
    info.category = 'auth';
  }
  
  return info;
}

export default {
  analyzeErrorGroup,
  detectRecurringPatterns,
  suggestFix,
  getErrorInfo
};
