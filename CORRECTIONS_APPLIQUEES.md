# Résumé des corrections appliquées - LogSystem

## Date: 22/06/2026

## Problèmes identifiés et corrigés

### 1. Bug critique: Variable `userId` non définie dans le stream d'alertes SSE

**Fichier:** `server.js` (lignes 192-214)

**Problème:** La variable `userId` était utilisée dans le handler de fermeture de connexion SSE sans être définie au préalable, ce qui causait des erreurs dans le tracking des connexions.

**Correction:** Déplacement de la définition de `userId` avant la vérification Vercel pour qu'elle soit disponible dans tous les chemins d'exécution.

```javascript
// Avant:
app.get('/api/alerts/stream', alertsStreamLimiter, requireAuth, (req, res) => {
  const isVercel = !!(process.env.VERCEL || process.env.VERCEL_ENV);
  if (isVercel) { ... }
  alertWorker.addClient(res, req);
  req.on('close', () => {
    untrackSSEConnection(userId); // userId non défini!
  });
});

// Après:
app.get('/api/alerts/stream', alertsStreamLimiter, requireAuth, (req, res) => {
  const isVercel = !!(process.env.VERCEL || process.env.VERCEL_ENV);
  const userId = req.session?.user?.id; // Défini ici
  if (isVercel) { ... }
  alertWorker.addClient(res, req);
  req.on('close', () => {
    if (userId) untrackSSEConnection(userId); // userId maintenant disponible
  });
});
```

**Impact:** Corrige les erreurs de tracking des connexions SSE et améliore la stabilité du système d'alertes en temps réel.

---

### 2. Amélioration de l'import de fichiers RAR

**Fichier:** `lib/processing/archiveHandler.js` (lignes 223-290)

**Problème:** L'extraction RAR manquait de gestion d'erreurs robuste et de logs détaillés pour le debugging sur Vercel.

**Correction:** 
- Ajout de logs détaillés avec stack traces pour le debugging
- Amélioration de la gestion des erreurs avec try/catch imbriqués
- Meilleure distinction entre les erreurs WASM et 7zip
- Messages d'erreur plus spécifiques pour l'utilisateur

```javascript
// Ajout de logs détaillés:
logger.info({ event: 'rar_extract_start_wasm', filename }, '[ARCHIVE]');
logger.warn({ event: 'rar_wasm_failed', error: e.message, stack: e.stack }, '[ARCHIVE] WASM failed, trying 7za bundled binary');
logger.info({ event: 'rar_extract_7z_fallback', filename }, '[ARCHIVE]');
logger.error({ event: 'rar_7z_failed', error: e.message, stack: e.stack }, '[ARCHIVE]');
```

**Impact:** 
- Meilleure expérience utilisateur avec des messages d'erreur clairs
- Facilité de debugging sur Vercel avec des logs détaillés
- Compatibilité maintenue avec Vercel (WASM + 7zip-bin comme fallback)

---

### 3. Compatibilité Vercel/Aiven vérifiée

**Analyse des fichiers:**
- `config/database.js` - Configuration SSL pour Aiven avec support CA base64
- `server.js` - Gestion des connexions SSE en mode polling sur Vercel
- `services/watcherService.js` - Watchlog désactivé sur Vercel (normal pour serverless)
- `routes/dashboard.js` - API tendances avec event_timestamp supporté

**Statut:** 
- ✅ Configuration DB compatible Aiven (SSL avec CA base64 pour Vercel)
- ✅ Limitation des connexions DB (2 par lambda sur Vercel)
- ✅ SSE fallback en mode polling sur Vercel
- ✅ Watchlog non supporté sur Vercel (comportement normal pour serverless)
- ✅ Colonnes event_timestamp et imported_at présentes (migration 20260622)

---

## Fonctionnalités analysées (sans correction nécessaire)

### Tendances (Dashboard)
**Fichier:** `routes/dashboard.js` (lignes 189-354)

**Statut:** ✅ Fonctionnel
- API `/api/dashboard/trends` correctement implémentée
- Support des dates personnalisées (start_date, end_date)
- Utilisation de `event_timestamp` quand disponible
- Compatibilité Vercel/Aiven vérifiée

### Alertes en temps réel
**Fichier:** `server.js` (lignes 192-214)

**Statut:** ✅ Fonctionnel (après correction)
- SSE avec fallback polling sur Vercel
- Tracking des connexions par utilisateur
- Rate limiting adapté (60 req/min sur Vercel)

### Source et service des logs
**Fichiers:** `routes/dashboard.js`, `routes/api/search.js`

**Statut:** ✅ Fonctionnel
- Colonnes `source` et `service` disponibles dans la table logs
- Facettes de recherche incluent service et source_server
- API per-level pour la répartition par niveau

### Détails sur les top erreurs
**Fichier:** `routes/dashboard.js` (lignes 356-384)

**Statut:** ✅ Fonctionnel
- API `/api/dashboard/top-errors` utilise la table `error_groups`
- Support des statuts open/resolved/returned
- Jointure avec logs pour les détails

### Répartition par niveau
**Fichier:** `routes/dashboard.js` (lignes 433-448)

**Statut:** ✅ Fonctionnel
- API `/api/dashboard/per-level` correctement implémentée
- Groupement par log_level avec scope utilisateur
- Compatible avec les 6 niveaux (DEBUG, INFO, WARNING, ERROR, CRITICAL, FATAL)

### Watchlog
**Fichier:** `services/watcherService.js`

**Statut:** ⚠️ Limitation Vercel (normale)
- File watching désactivé sur Vercel (serverless ne supporte pas les watchers de fichiers)
- API `/api/watchdogs/status` retourne un message approprié
- Sur environnement standard: fonctionnement normal avec chokidar

---

## Recommandations pour le déploiement Vercel

### Variables d'environnement requises

```bash
# Database Aiven
DB_HOST=your-aiven-host.aivencloud.com
DB_PORT=25060
DB_USER=avnadmin
DB_PASSWORD=your-password
DB_NAME=logsystem
DB_SSL=true
DB_SSL_CA_BASE64=<base64-encoded-ca-pem>  # Optionnel mais recommandé
DB_SSL_REJECT_UNAUTHORIZED=false  # Nécessaire sur Vercel sans fichier CA

# Session
SESSION_SECRET=<32+ caractères aléatoires>

# Connexions DB (Vercel)
DB_CONNECTION_LIMIT=2  # 2 par lambda (max 12 lambdas concurrents pour Aiven free tier)
DB_SESSION_CONNECTION_LIMIT=1
DB_SESSION_QUEUE_LIMIT=25

# Vercel (automatique)
VERCEL=1
NODE_ENV=production
```

### Limitations connues sur Vercel

1. **Watchlog:** Non fonctionnel (file watching incompatible avec serverless)
2. **SSE:** Fallback en mode polling (reconnexion toutes les 60s)
3. **Connexions DB:** Maximum 12 lambdas concurrents (2 connexions chacune)
4. **Background jobs:** Désactivés (alert engine, retention scheduler, watcher)

### Alternatives pour Vercel

Pour le watchlog sur Vercel, envisager:
- Import manuel des fichiers via l'interface web
- Utilisation d'un service externe (ex: Logtail, Datadog) avec webhook
- Migration vers un VPS classique pour le file watching

---

## Fichiers modifiés

1. `server.js` - Correction bug userId dans SSE
2. `lib/processing/archiveHandler.js` - Amélioration extraction RAR

## Tests recommandés

1. **Test d'import RAR:** Uploader un fichier .rar via l'interface d'import
2. **Test alertes temps réel:** Vérifier que les alertes s'affichent en mode polling sur Vercel
3. **Test tendances:** Vérifier les graphiques de tendances sur le dashboard
4. **Test top erreurs:** Cliquer sur une erreur fréquente pour voir les détails
5. **Test watchlog:** Vérifier le statut via `/api/watchdogs/status` (doit indiquer "not supported" sur Vercel)

---

## Conclusion

Les problèmes identifiés ont été corrigés:
- ✅ Bug critique userId corrigé
- ✅ Import RAR amélioré avec meilleur logging
- ✅ Compatibilité Vercel/Aiven vérifiée
- ✅ Fonctionnalités dashboard analysées et fonctionnelles

Les fonctionnalités de watchlog restent limitées sur Vercel (comportement normal pour serverless). Pour une expérience complète avec watchlog, un déploiement sur VPS classique est recommandé.