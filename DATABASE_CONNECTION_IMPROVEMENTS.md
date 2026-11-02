# Améliorations de la Connexion Base de Données

Date : 2026-10-23
Problème identifié : Base MySQL Aiven devient injoignable après démarrage

## Problème Observé

Chronologie :
- +0s : Connexion réussie (`db_connected`)
- +16s : `retention_rollback_failed` avec "Connection lost: The server closed the connection"
- +31s : `eval_all_error` avec `ECONNREFUSED 188.166.48.79:21661`

Cause : Le serveur MySQL chez Aiven s'est arrêté ou redémarré (probablement offre gratuite/maintenance).

## Corrections Appliquées

### 1. Pool Error Handler (config/database.js)

**Avant** : Pas de handler pour les erreurs de pool
**Après** : Ajout de `pool.on('error')` pour logger et gérer les erreurs de pool

```javascript
pool.on('error', (err) => {
  logger.error({ event: 'db_pool_error', error: err.message, code: err.code }, '[DB] Pool error occurred');
});
```

**Bénéfice** : mysql2 recréera automatiquement les connexions défaillantes

### 2. Amélioration du Rollback (services/retentionService.js)

**Avant** : Si rollback échoue, détruit systématiquement la connexion
**Après** : Détruit la connexion seulement si l'erreur est transiente

```javascript
if (isTransientDatabaseError(rollbackError)) {
  destroyConnection = true;
}
```

**Bénéfice** : Évite de détruire inutilement des connexions valides

### 3. Masquage des Infos Sensibles (config/database.js)

**Avant** : Logs exposent l'hôte complet et l'utilisateur de la base
**Après** : Masquage de l'IP et de l'utilisateur dans les logs

```javascript
const hostMasked = dbConfig.host.replace(/\d+\.\d+\.\d+\.\d+/, '***.***.***.***');
const userMasked = dbConfig.user.substring(0, 3) + '***';
```

**Bénéfice** : Réduit les fuites d'informations dans les logs

### 4. Documentation SSL (.env.example)

**Avant** : Configuration SSL mal documentée
**Après** : Documentation claire avec recommandations de sécurité

**Bénéfice** : Guide les utilisateurs vers une configuration sécurisée

## État de l'Endpoint /health

✅ L'endpoint `/health` existe déjà et teste la connexion à la base :
- Retourne 503 si la base est inaccessible
- Retourne 200 si tout est OK
- Peut être branché sur le health check de Render

## Corrections Recommandées (Non Appliquées)

### Priorité 1 (Urgent)

1. **Vérifier l'état du service Aiven**
   - Rallumer le service si éteint
   - Vérifier s'il s'agit de l'offre gratuite (hibernation)
   - Considérer un plan payant pour éviter les mises en veille

2. **Corriger `rejectUnauthorized=false` avec `ca=true`**
   - Si CA fourni : `rejectUnauthorized=true`
   - Si CA non fourni : fournir le CA Aiven ou accepter le risque

### Priorité 2 (Important)

3. **Séparer les jobs du serveur web**
   - Actuellement : alertes, rétention, watcher dans le même processus
   - Problème : job lourd peut ralentir les requêtes
   - Solution : Utiliser GET_LOCK MySQL ou worker séparé

4. **Stockage persistant pour les imports**
   - Actuellement : `uploads/` est éphémère sur Render
   - Problème : fichiers disparaissent au redéploiement
   - Solution : S3, Cloudflare R2, ou disque persistant payant

### Priorité 3 (Amélioration)

5. **Forcer le changement du mot de passe admin**
   - Actuellement : mot de passe par défaut en production
   - Solution : Exiger le changement au premier login

6. **Configurable seed des règles d'alerte**
   - Actuellement : seed à chaque démarrage
   - Solution : Vérifier idempotence et ne pas écraser les règles utilisateur

## Vulnérabilités de Sécurité

Voir `SECURITY_AUDIT.md` pour l'audit complet des 19 vulnérabilités npm.

## Fonctionnalités Non Disponibles sur Render

- **Watcher de fichiers** : Désactivé (stockage éphémère)
- **Stockage des uploads** : Éphémère (disparaît au redéploiement)
- **Redis** : Non configuré (cache en mode dégradé)
- **Mise en veille** : Offre gratuite hiberne après inactivité

## Tests Recommandés

1. Tester la reconnexion après arrêt/redémarrage de la base
2. Tester l'endpoint `/health` quand la base est inaccessible
3. Vérifier que les logs ne contiennent plus d'IP ou d'utilisateur complets
4. Tester la configuration SSL avec `rejectUnauthorized=true`
