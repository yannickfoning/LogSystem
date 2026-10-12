import pool from '../config/database.js';
import logger from '../config/logger.js';

const DEFAULT_RECOMMENDATIONS = [
  { errorType: 'ECONNREFUSED', recommendation: 'Connexion refusée : vérifiez que le service cible fonctionne, son adresse, le pare-feu et les règles réseau.', priority: 10 },
  { errorType: 'ETIMEDOUT', recommendation: 'Délai réseau dépassé : vérifiez la latence, les timeouts, le pare-feu et la disponibilité du service.', priority: 8 },
  { errorType: 'ER_ACCESS_DENIED_ERROR', recommendation: 'Accès base refusé : contrôlez le compte, les privilèges et les identifiants configurés.', priority: 10 },
  { errorType: 'ER_NO_SUCH_TABLE', recommendation: 'Table absente : vérifiez le schéma de la base et appliquez les migrations manquantes.', priority: 9 },
  { errorType: 'HTTP 500', recommendation: 'Erreur serveur : examinez la trace applicative associée et vérifiez la dernière configuration déployée.', priority: 9 },
  { errorType: 'HTTP 503', recommendation: 'Service indisponible : vérifiez son état de santé, ses redémarrages, sa charge et ses dépendances.', priority: 8 },
  { errorType: 'HTTP 404', recommendation: 'Ressource introuvable : vérifiez la route, l’URL, la méthode et les paramètres de la requête.', priority: 5 },
  { errorType: 'TypeError', recommendation: 'Type de donnée inattendu : vérifiez le contenu de la requête et la réponse du service amont.', priority: 6 },
  { errorType: 'ReferenceError', recommendation: 'Variable absente : vérifiez les imports, l’initialisation et la portée de la variable.', priority: 7 },
  { errorType: 'ENOENT', recommendation: 'Fichier introuvable : vérifiez le chemin, le montage Docker et les permissions de lecture.', priority: 7 },
  { errorType: 'ENOMEM', recommendation: 'Mémoire insuffisante : vérifiez la limite mémoire du conteneur et recherchez une hausse anormale de consommation.', priority: 9 },
  { errorType: 'Authentication failed', recommendation: 'Échec d’authentification : vérifiez le compte, l’expiration des jetons et la configuration du fournisseur d’identité.', priority: 8 },
  { errorType: 'Validation failed', recommendation: 'Validation échouée : comparez les champs reçus au format attendu et indiquez les champs manquants.', priority: 5 },
  { errorType: 'ER_DUP_ENTRY', recommendation: 'Entrée dupliquée : vérifiez la clé unique et rendez l’opération idempotente si elle peut être rejouée.', priority: 6 },
  { errorType: 'ENOSPC', recommendation: 'Espace disque épuisé : contrôlez le stockage Docker, les volumes et les fichiers temporaires avant de relancer le traitement.', priority: 10 },

  { errorType: '*', logFormat: 'apache', recommendation: 'Apache : corrélez le code HTTP avec le journal error.log, puis vérifiez le virtual host, les permissions et le service amont.', priority: 8 },
  { errorType: '*', logFormat: 'nginx', recommendation: 'Nginx : vérifiez le code HTTP, la résolution DNS de l’upstream, les timeouts et les journaux error.log.', priority: 8 },
  { errorType: '*', logFormat: 'docker', recommendation: 'Docker : vérifiez le code de sortie, le healthcheck, les limites CPU/mémoire et les dépendances du conteneur.', priority: 8 },
  { errorType: '*', logFormat: 'kubernetes', recommendation: 'Kubernetes : contrôlez les événements du Pod, les redémarrages, les probes, les limites de ressources et les ConfigMaps/Secrets.', priority: 9 },
  { errorType: '*', logFormat: 'syslog', recommendation: 'Syslog : identifiez l’hôte et le processus émetteur, puis vérifiez systemd, les permissions et l’état des dépendances.', priority: 7 },
  { errorType: '*', logFormat: 'java', recommendation: 'Java : partez de la première cause de la stack trace et vérifiez heap, pools de threads et connexions aux dépendances.', priority: 8 },
  { errorType: '*', logFormat: 'python', recommendation: 'Python : identifiez la première exception de la traceback et vérifiez les dépendances, entrées et appels réseau.', priority: 8 },
  { errorType: '*', logFormat: 'php', recommendation: 'PHP : vérifiez la première erreur fatale, la configuration PHP-FPM, les extensions et les permissions des fichiers.', priority: 8 },
  { errorType: '*', logFormat: 'odoo', recommendation: 'Odoo : vérifiez le module concerné, les workers, la connexion PostgreSQL et les tâches cron autour de l’événement.', priority: 8 },
  { errorType: '*', logFormat: 'json', recommendation: 'JSON : vérifiez les champs obligatoires, les types, le fuseau horaire et l’encodage de l’événement.', priority: 4 },
  { errorType: '*', logFormat: 'jsonl', recommendation: 'JSONL : validez chaque ligne séparément et repérez les lignes tronquées ou les champs dont le type varie.', priority: 4 },
  { errorType: '*', logFormat: 'csv', recommendation: 'CSV : contrôlez les en-têtes, le séparateur, les guillemets et l’alignement des colonnes.', priority: 4 },
  { errorType: '*', logFormat: 'xml', recommendation: 'XML : validez la structure, les balises, les namespaces et les champs d’horodatage.', priority: 4 },
];

export async function ensureDefaultRecommendations() {
  try {
    const [tables] = await pool.execute(
      `SELECT COUNT(*) AS cnt FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'error_recommendations'`
    );
    if (!tables[0]?.cnt) return;

    const [adminUsers] = await pool.execute(
      "SELECT id FROM users WHERE role = 'admin' AND is_active = 1 ORDER BY id ASC LIMIT 1"
    );
    const creatorId = adminUsers[0]?.id;
    if (!creatorId) {
      logger.info({ event: 'recommendations_seed_skipped', reason: 'no_admin' }, '[RECOMMENDATIONS]');
      return;
    }

    let seeded = 0;
    for (const item of DEFAULT_RECOMMENDATIONS) {
      const [result] = await pool.execute(
        `INSERT INTO error_recommendations
           (error_type, log_format, event_type, log_level, recommendation, priority, is_active, created_by)
         SELECT ?, ?, ?, ?, ?, ?, 1, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM error_recommendations
           WHERE error_type = ? AND log_format <=> ? AND event_type <=> ? AND log_level <=> ? AND is_active = 1
         )`,
        [
          item.errorType,
          item.logFormat || null,
          item.eventType || null,
          item.logLevel || null,
          item.recommendation,
          item.priority,
          creatorId,
          item.errorType,
          item.logFormat || null,
          item.eventType || null,
          item.logLevel || null,
        ]
      );
      seeded += Number(result.affectedRows) || 0;
    }

    if (seeded) logger.info({ event: 'default_recommendations_seeded', count: seeded }, '[RECOMMENDATIONS]');
  } catch (e) {
    logger.error({ event: 'recommendations_seed_error', error: e.message }, '[RECOMMENDATIONS]');
  }
}
