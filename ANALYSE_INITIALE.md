# LogSystem — Rapport d'analyse initiale

Date : 19 juin 2026
Portée : analyse statique du dépôt fourni (hors exécution réelle contre Aiven/Vercel, le bac à sable n'a pas d'accès réseau sortant).

## 1. Vue d'ensemble réelle

- Stack : Node.js 20 (ESM), Express 4, MySQL via `mysql2` (Aiven), sessions stockées en MySQL, Redis optionnel (cache dashboard), vanilla JS/HTML/CSS côté client (pas de framework front).
- Version actuelle : `6.0.0`. Historique git actif (`main` ↔ `origin/main` synchronisés), nombreux commits de durcissement sécurité et de correctifs de déploiement.
- Documentation existante de bonne qualité : `ARCHITECTURE.md`, `DEPLOYMENT_GUIDE.md`, `VERCEL_DEPLOYMENT.md`, `DEV_PROD_SETUP.md`, `RESPONSIVE_TESTING.md`, `TODO.md` — tous à jour et cohérents avec le code.
- Déploiement déjà pensé en hybride : Vercel (frontend + API rapides) + Render (workers stateful : watcher de fichiers, SSE, moteur d'alertes) + Aiven MySQL + Redis (Upstash recommandé sur Vercel). `vercel.json` et `render.yaml` sont tous deux présents et cohérents avec cette décision.
- CI : workflow GitHub Actions (`.github/workflows/node.js.yml`) qui installe les dépendances et lance `npm test` sur push/PR vers `main`.

**Conclusion** : ce n'est pas un projet à reconstruire depuis zéro. C'est un projet à auditer, stabiliser et finir, avec des corrections ciblées.

## 2. Ce qui fonctionne déjà bien (à ne pas casser)

| Domaine | Constat |
|---|---|
| Sécurité headers | Helmet + CSP avec nonce par requête, HSTS en prod, `crossOriginEmbedderPolicy` désactivé volontairement (à garder en tête si vous activez des features qui en ont besoin) |
| Rate limiting | Limiteur global (500 req/15min) + limiteur dédié login (10 tentatives/15min) |
| Sessions | `express-mysql-session`, secret validé au démarrage (`SESSION_SECRET` doit faire ≥32 caractères et ne pas contenir `change-me`, sinon le process s'arrête — bon réflexe anti-déploiement-non-sécurisé) |
| CSRF | Middleware dédié (`middleware/csrf.js`) |
| Isolation multi-utilisateur | `middleware/scopeGuard.js` + script de vérif dédié `scripts/tools/verify-isolation.js` |
| Audit | `middleware/audit.js` + `recordAudit()` appelé sur les actions sensibles |
| Secrets | `.env` correctement exclu du suivi git (`.gitignore` contient `*.env`), confirmé via `git check-ignore` |
| Migrations | Runner dédié (`lib/database/migrationRunner.js`), 18 fichiers de migration, schéma versionné |
| Tests | `tests/security.test.js` et `tests/critical.test.js` existent et couvrent des chemins sensibles |

## 3. Problèmes réels identifiés

### 🔴 Bug confirmé — export PDF cassé
`lib/pdfExport.js` ligne 55 : la boucle fait `entryCount++` alors que la variable déclarée est `_entryCount` (ligne 38). En ESM (mode strict implicite), c'est une `ReferenceError` non interceptée → **toute tentative d'export PDF plantera** dès qu'il y a au moins un log à exporter. Confirmé par `eslint` (`'entryCount' is not defined — no-undef`), seule erreur bloquante du lint. Correction triviale (une ligne), mais à valider avant de la pousser.

### 🟡 Code mort / dupliqué
- `config/logLevelUtils.js` : fichier vide (0 octet), non importé nulle part.
- `services/logLevelUtils.js` : logique de normalisation de niveau de log dupliquée avec `lib/levels.js`, mais **non importé par aucun autre fichier** — c'est `lib/levels.js` qui est réellement utilisé (tests, `routes/import.js`, `services/alertEngine.js`, `services/watcherService.js`, `lib/processing/parseTxt.js`).
- À trancher : supprimer les deux fichiers orphelins ou clarifier leur rôle si prévu pour un usage futur.

### 🟡 Hygiène lint
69 problèmes ESLint au total (1 erreur ci-dessus + 68 avertissements), quasi tous des variables/erreurs `catch` non utilisées (`'e' is defined but never used`, etc.) dans `routes/`, `lib/processing/`, `middleware/`, `workers/`. Aucun ne casse l'app, mais ça masque les vraies erreurs et indique des blocs `catch` qui avalent silencieusement des erreurs sans les logger — à vérifier au cas par cas (certains `catch (e)` ignorent peut-être une erreur qui mériterait un `logger.warn`).

### 🟡 État git non figé
38 fichiers modifiés non commités dans l'arborescence fournie (routes, migrations, frontend, scripts de maintenance...). Avant toute intervention supplémentaire, il faut clarifier : ce sont des changements en cours que vous voulez garder, ou un état intermédiaire à examiner/jeter ? Je n'ai rien committé ni écrasé.

### 🟠 Suite de tests non exécutable dans ce bac à sable
`npx vitest run` échoue immédiatement avec une erreur de binding natif manquant (`@rolldown/binding-linux-x64-gnu`, dépendance de Vitest 4). C'est un `node_modules` packagé pour une autre plateforme/architecture que ce bac à sable Linux x64 — je n'ai pas d'accès réseau sortant ici pour relancer `npm install` et corriger ça moi-même. **À vérifier dans votre propre environnement** : si `npm test` passe chez vous/en CI, ignorez ce point ; sinon c'est un vrai problème d'environnement à régler (souvent : supprimer `node_modules` + `package-lock.json` et refaire `npm install`).

### 🔵 Remarque secrets (faible risque, hygiène)
Le fichier `.env` réel (avec identifiants Aiven, secrets de session/CSRF) était inclus dans le ZIP transmis. Il est correctement ignoré par git, donc pas de fuite côté dépôt — mais comme ce ZIP a maintenant transité par cette conversation, c'est une bonne pratique de **régénérer `SESSION_SECRET`, `CSRF_SECRET` et le mot de passe Aiven** par précaution, plutôt que de les considérer toujours secrets.

## 4. Ce que je n'ai pas pu vérifier ici

- Connexion réelle à Aiven (pas de réseau sortant dans ce bac à sable).
- Build/déploiement réel sur Vercel.
- Comportement runtime complet (je n'ai pas démarré le serveur faute de base de données accessible).
- Couverture fonctionnelle des tests (la suite ne s'est pas exécutée, cf. point ci-dessus).

## 5. Recommandation

Plutôt qu'une reconstruction complète (risquée, coûteuse, et qui jetterait des mois de durcissement sécurité déjà en place), je propose un audit ciblé + correctifs priorisés, dans cet ordre suggéré :

1. Corriger le bug d'export PDF (1 ligne, sûr).
2. Statuer sur les 38 fichiers modifiés non commités.
3. Nettoyer le code mort (`logLevelUtils` x2).
4. Passer le lint à zéro avertissement (qualité, pas de risque fonctionnel).
5. Auditer en profondeur un domaine à la fois (sécurité API, performance des requêtes `routes/logs.js`/`routes/dashboard.js`, ou UI responsive) plutôt que tout en parallèle.

Dites-moi par quoi vous voulez commencer.
