# LogSystem — Corrections appliquées (session du 20 juin 2026)

Ce document liste **uniquement les changements que j'ai effectués dans cette session**, fichier par fichier, avec la ligne concernée, le problème identifié et le correctif appliqué. Les 38 fichiers que vous aviez déjà modifiés avant l'envoi du ZIP (ex. `routes/api/search.js`, `public/dashboard.html`, `lib/processing/detectFormat.js`, `services/errorAnalyzer.js`, `DEPLOYMENT_GUIDE.md`, etc.) ont été **conservés tels quels**, comme demandé — je n'y ai pas touché, sauf mention explicite ci-dessous.

État final vérifié dans ce bac à sable : **ESLint → 0 erreur, 0 avertissement** (69 → 0). **`node scripts/validate-build.js` → succès** (58 fichiers). Détails et limites de vérification en bas de page.

---

## 🔴 Bugs critiques corrigés

### 1. Export PDF cassé — `lib/pdfExport.js:55`
**Problème :** boucle utilisait `entryCount++` alors que la variable déclarée était `_entryCount`. En ESM (mode strict), c'est une `ReferenceError` non interceptée.
**Impact :** tout export PDF plantait dès qu'il y avait au moins un log.
**Correctif :** `entryCount++` → `_entryCount++`.

### 2. `esc()` non définie — `public/search.html`, `public/admin.html`, `public/import.html`
**Problème :** ces trois pages appellent une fonction `esc(...)` (échappement HTML) dans leur script inline, mais ne la définissent jamais et ne l'importent pas non plus. `app-common.js` (chargé avant) définit `window.escapeHtml`, mais aucun alias `esc` n'existe en portée.
**Impact réel, confirmé par lecture du code :**
- `search.html` : le rendu des résultats de recherche **et** la modale de détail d'un log plantent (`ReferenceError: esc is not defined`) dès qu'un résultat doit s'afficher.
- `admin.html` : le **tableau de gestion des utilisateurs** et le **journal d'audit** — les deux vues principales de l'administration — sont cassés de la même façon.
- `import.html` : la liste d'historique des imports est cassée.

C'est le bug le plus sérieux trouvé dans cet audit : trois pages métier centrales étaient non fonctionnelles côté affichage.
**Correctif :** ajout de `var esc = window.escapeHtml;` en tête du script inline de chacun des trois fichiers, réutilisant la fonction d'échappement sûre déjà présente dans `app-common.js` (technique `textContent` → `innerHTML`, protège contre l'injection XSS).

### 3. Cache dashboard jamais invalidé après lecture d'alertes — `routes/dashboard.js`
**Problème :** `invalidateDashboard` était importé mais jamais appelé ; une variable `currentUserId` était calculée puis jamais utilisée — signe clair d'une intégration commencée mais jamais terminée. Le compteur `unread_alerts` est mis en cache 5 minutes (`CACHE_TTL_STATS`).
**Impact :** après avoir marqué des alertes comme lues (`PUT/POST /alerts/read-all`, `PUT /alerts/:id/read`), le badge "alertes non lues" du tableau de bord restait obsolète jusqu'à 5 minutes si Redis est actif.
**Correctif :** appel de `invalidateDashboard(userId)` dans les trois routes concernées.

### 4. Cache dashboard non invalidé après suppression d'un log — `routes/logs.js`
**Même catégorie de bug que ci-dessus**, sur `DELETE /api/logs/:id` (suppression admin et auto-suppression). Import et appel de `invalidateDashboard` ajoutés pour cohérence.

### 5. `status` de `recordAudit()` silencieusement perdu — `middleware/audit.js`, `db/schema.sql`
**Problème :** `recordAudit({ ..., status })` acceptait un paramètre `status` (défaut `'success'`) qui n'était **jamais inséré en base** : la table `audit_log` n'avait pas de colonne `status`. L'information ne survivait que noyée dans le JSON `details`, donc non filtrable/indexable.
**Correctif :**
- Nouvelle migration `db/migrations/20260620_audit_log_status.sql` (`ALTER TABLE audit_log ADD COLUMN status VARCHAR(20) DEFAULT 'success'` + index).
- `db/schema.sql` mis à jour pour les installations neuves.
- `middleware/audit.js` : `status` ajouté à l'`INSERT` et propagé en tant que champ de premier niveau depuis `auditMiddleware`, plus seulement dans `details`.

### 6. `generateSuggestion()` ignorait la stack trace — `routes/logs.js`
**Problème :** la fonction calculait `stack` (stack trace en minuscules) mais ne la consultait jamais — seul `message` était testé. Une erreur dont le message ne contient pas le mot-clé pertinent (ex. erreur DB encapsulée par le code applicatif, indice uniquement présent dans la stack) ne recevait aucune suggestion utile.
**Correctif :** les motifs de correspondance (401, 403, 500, null/undefined, mémoire, deadlock…) sont désormais cherchés dans `message + stack` combinés, pas seulement `message`.

---

## 🟡 Dette technique / code mort supprimé

| Fichier | Constat |
|---|---|
| `config/logLevelUtils.js` | Fichier vide (0 octet), non importé nulle part → **supprimé**. |
| `services/logLevelUtils.js` | Doublon de `lib/levels.js`, non importé nulle part (confirmé par recherche globale) → **supprimé**. |
| `routes/import.js` | Constante `SEV_ORDER` jamais utilisée — la comparaison de sévérité se fait déjà en SQL via `FIELD()` → **supprimée**. |
| `routes/logs.js` | Fonction `pdfTableRow()` jamais appelée — la génération PDF est déléguée à `lib/pdfExport.js` → **supprimée**. Import de `requireAdmin`, `startWatcher`, `stopWatcher`, `getWatcherStatus` jamais utilisés → **retirés**. Destructuration de 8 paramètres de filtre (`log_level`, `source`, etc.) sur la route `GET /` jamais utilisée — les filtres sont en réalité appliqués via `buildFilters(req.query, ...)` juste en dessous, donc **aucune régression fonctionnelle**, juste du code redondant retiré. Paramètre `useImportedAtForDateRange` jamais lu dans le corps de la fonction ni jamais passé à `true` par un appelant — fonctionnalité déjà couverte différemment par les filtres explicites `imported_from`/`imported_to` → **retiré**. |
| `lib/processing/encodingDetector.js` | Variables `validUtf8` et `decoded` calculées puis jamais lues → simplifiées sans changement de comportement. |
| `lib/logParser.js`, `routes/import.js` | Initialisations `let x = []` toujours écrasées avant lecture → nettoyées. |
| `routes/auth.js`, `lib/processing/universalParser.js` | Imports `crypto` jamais utilisés → retirés. |
| `services/watcherService.js` | Résultat d'`INSERT IGNORE` capturé puis jamais utilisé (déjà documenté en commentaire : non fiable avec `INSERT IGNORE` en lot) → retiré proprement. Échappement regex inutile `[\/\\]` → `[/\\]`. |
| `scripts/setup/seed.js`, `scripts/tools/verify-isolation.js` | Imports `uuid`/`logger` jamais utilisés → retirés. |

## 🟡 Erreurs silencieuses rendues visibles

Une dizaine de blocs `catch (e) { res.status(500)... }` à travers `routes/auth.js`, `routes/dashboard.js`, `routes/import.js`, `routes/logs.js` ne journalisaient **jamais** l'erreur réelle côté serveur — en production, une panne (DB indisponible, requête malformée, etc.) aurait été invisible dans les logs, seul un message générique partait au client. Chacun de ces blocs journalise maintenant l'erreur via `logger.error(...)` avant de répondre. `middleware/scopeGuard.js` (middleware d'isolation des données, donc sensible côté sécurité) était dans le même cas → corrigé en priorité.

Les `catch` qui géraient des cas attendus/routiniers (client SSE déconnecté dans `workers/alertWorker.js`, fallback d'encodage, parsing JSON best-effort) ont simplement été renommés `catch (_e)` selon la convention déjà en place dans le projet (`eslint.config.mjs` exige `^_` pour les variables volontairement inutilisées) — pas besoin de les journaliser, ce sont des branches de contrôle normales, pas des pannes.

## 🟢 Tests

- `tests/critical.test.js` : `afterAll` était importé mais jamais câblé — aucun `pool.end()` nulle part dans la suite. Ajouté un `afterAll(() => pool.end())` pour que `npm test` ferme proprement la connexion MySQL au lieu de risquer un process qui ne se termine pas après les tests.
- `tests/security.test.js` : import `beforeEach` inutilisé retiré (les mocks sont recréés localement à chaque `it()`, rien à réinitialiser).

---

## ✅ Audit sécurité — ce qui a été vérifié (pas seulement supposé)

- **Injection SQL** : recherche systématique de toute interpolation `${...}` à proximité de `SELECT/INSERT/UPDATE/DELETE/WHERE` dans `routes/`, `lib/`, `services/`, `workers/`, `middleware/`, `config/`, `scripts/`. Toutes les occurrences trouvées construisent des fragments SQL fixes (`"role = ?"`, `scope.sql` avec placeholders `?`) — les valeurs réellement injectées passent toujours par un tableau `params` lié. Aucune injection trouvée.
- **XSS** : un seul usage direct de `.innerHTML` en dehors des pages HTML (`app-common.js`, qui est l'utilitaire d'échappement lui-même, technique sûre `textContent`→`innerHTML`). Les pages HTML utilisent `esc()`/`escapeHtml` de façon cohérente sur les données utilisateur avant insertion DOM (une fois le bug `esc` non définie corrigé, cf. plus haut).
- **Cookies de session** : `httpOnly: true`, `secure` en production, `sameSite: 'lax'` — conforme aux bonnes pratiques.
- **CSRF** : comparaison à temps constant (`crypto.timingSafeEqual`) déjà en place, correcte.
- **Extraction d'archives (ZIP/RAR)** : le chemin ZIP traite tout en mémoire (jamais d'écriture disque basée sur le nom de fichier de l'archive) — donc pas de zip-slip possible par construction. Le chemin RAR/7z via binaires système écrit dans un répertoire temporaire dédié, supprimé après usage ; c'est une zone qui dépend in fine des protections de l'outil `unrar`/`7z` du système contre la traversée de chemin (`../`), point de vigilance standard pour tout usage de CLI d'extraction tierce, mais pas un défaut spécifique à ce code.
- **CORS** : aucune configuration CORS — c'est correct pour une appli à cookies de session same-origin ; en ajouter une de façon permissive serait une régression de sécurité, pas une amélioration.

## ⚠️ Point d'architecture à reconfirmer avec vous — SSE et Vercel

`vercel.json` route tout (`/(.*)`) vers `server.js` en fonction serverless (`maxDuration: 60`). Or vos `EventSource` (`/api/alerts/stream`, `/api/logs/watch/stream`) utilisés par `dashboard.html`, `admin.html` et `watchlog.html` sont des connexions persistantes — incompatibles avec le modèle serverless de Vercel. **Ce n'est pas un bug que j'ai introduit ni un point caché** : `DEV_PROD_SETUP.md` et `VERCEL_DEPLOYMENT.md` documentent déjà explicitement cette limitation ("Pas de SSE persistant sur Vercel", "Watcher temps réel désactivé", `START_BACKGROUND_JOBS=false` sur Vercel) et `server.js` la respecte bien dans le code (`IS_VERCEL` désactive les jobs de fond). 

Concrètement : si vous déployez **uniquement** sur Vercel, les alertes temps réel et le suivi de logs en direct ne fonctionneront pas (c'est documenté, assumé, pas un oubli). Pour avoir les notifications temps réel demandées dans votre cahier des charges, il faut le second service "always-on" (Render, déjà configuré dans `render.yaml`) en plus de Vercel. Dites-moi si c'est bien l'architecture cible voulue — sinon il faut soit migrer le SSE vers du polling (fonctionne sur Vercel seul, moins "temps réel"), soit confirmer le déploiement hybride.

## 🟡 Dette technique notée (non corrigée, risque de la "corriger" sans base réelle pour tester)

- `db/migrations/` contient l'index `idx_logs_imported_at` recréé à l'identique dans **quatre** fichiers de migration différents (`001_add_log_intelligence.sql`, `002_improvements.sql`, `20260607_log_temporal_metadata.sql`, `20260619_v6_complete.sql`). Le `migrationRunner.js` est idempotent et avale silencieusement les erreurs de doublon, donc ce n'est pas un bug fonctionnel, juste un historique de migrations qui aurait besoin d'un grand nettoyage un jour. Je n'ai pas consolidé ces fichiers car réécrire l'historique de migrations déjà potentiellement appliqué en production est risqué sans pouvoir tester contre votre vraie base Aiven.

---

## ❌ Ce qui ne s'applique pas / n'a pas pu être vérifié ici

- **TypeScript** : ce projet est en JavaScript pur (`"type": "module"`, pas de `.ts`, pas de `tsconfig.json`). Il n'y a donc rien à corriger côté TypeScript — je le mentionne pour que ce ne soit pas lu comme un point oublié.
- **`npm install` / `npm audit`** : impossible dans ce bac à sable (pas d'accès réseau sortant, confirmé par `npm error... Host not in allowlist: registry.npmjs.org`). À lancer de votre côté pour confirmer l'absence de vulnérabilités connues dans les dépendances.
- **`npm test` (Vitest)** : échoue immédiatement ici avec une erreur de binding natif manquant (`@rolldown/binding-linux-x64-gnu`) — un `node_modules` packagé pour une autre plateforme que ce bac à sable Linux, pas un défaut de votre code. À vérifier dans votre environnement réel/CI ; si ça échoue aussi chez vous, supprimez `node_modules` + `package-lock.json` et refaites `npm install`.
- **Connexion réelle à Aiven / déploiement réel Vercel** : aucun accès réseau sortant ici pour les tester en conditions réelles.
- J'ai lancé `node server.js` directement : il démarre sans erreur de syntaxe/import et reste actif (attendu — il tente de joindre MySQL sur `localhost:3306`, indisponible ici), ce qui est un signal positif faible mais réel sur l'intégrité du point d'entrée.

## Vérifications que j'ai pu faire et confirmer

| Commande | Résultat |
|---|---|
| `npx eslint .` | ✅ 0 erreur, 0 avertissement (69 → 0) |
| `node scripts/validate-build.js` | ✅ "Build validation passed (58 JS files checked)" |
| Cohérence `.env.example` vs `process.env.*` réellement utilisés dans le code | ✅ complet — seule variable non documentée : `VERCEL`, injectée automatiquement par la plateforme elle-même, déjà mentionnée dans la section notes en bas du fichier |
| `server.js` respecte bien `START_BACKGROUND_JOBS`/`IS_VERCEL` comme documenté | ✅ cohérent |

## Recommandation pour la suite

Tout ce qui précède a été vérifié sur le code réel, pas deviné. Pour la suite, dites-moi :
1. Confirmez-vous l'architecture hybride Vercel + Render pour avoir le temps réel ? (cf. point ⚠️ ci-dessus)
2. Voulez-vous que je relance un passage approfondi sur les fichiers que vous aviez déjà modifiés (`routes/api/search.js`, `public/dashboard.html`, `lib/processing/detectFormat.js`, etc.) — je ne les ai pas audités en détail puisque vous m'avez dit de les garder tels quels ?
