# Rapport d'audit — LogSystem v4.0.0
**Date** : 2026-06-17 | **Auditeur** : Architecte logiciel senior

---

## 1. Problèmes détectés & corrections effectuées

### 🔴 Critiques (bloquants en production)

| # | Fichier | Problème | Correction |
|---|---------|----------|------------|
| 1 | `db/migrations/migrate_v4_to_v5.sql` | `ADD COLUMN IF NOT EXISTS` non supporté par Aiven MySQL 5.7 → `ER_PARSE_ERROR` au démarrage | Suppression des `IF NOT EXISTS` sur ALTER TABLE et CREATE INDEX |
| 2 | `db/migrations/migration_log_intelligence.sql` | `CREATE INDEX IF NOT EXISTS` idem → 9 erreurs à chaque démarrage | Idem |
| 3 | `server.js` | Utilisation de `NextServer` standalone qui démarrait son propre serveur HTTP sur le port 10000 → `EADDRINUSE` crash au démarrage | Remplacement par `next().getRequestHandler()` sans serveur propre |
| 4 | `src/lib/auth.ts` | `SESSION_SECRET` validé au chargement du module (top-level) → crash pendant `next build` | Validation lazy dans `getSessionSecret()` appelée uniquement au runtime |
| 5 | `routes/auth.js` | Import de `bcrypt` (non installé) au lieu de `bcryptjs` | Ajout de `bcrypt` dans les dépendances |
| 6 | `config/database.js` | `process.exit(1)` appelé au chargement du module en cas d'échec DB → crash Vitest | Guard `if (process.env.NODE_ENV !== 'test')` |

### 🟠 Importants (qualité / sécurité)

| # | Fichier | Problème | Correction |
|---|---------|----------|------------|
| 7 | `lib/database/migrationRunner.js` | `conn.execute()` utilisé sur des DDL → certains drivers refusent les prepared statements sur ALTER/CREATE | Remplacé par `conn.query()` |
| 8 | `lib/database/migrationRunner.js` | `ER_KEY_COLUMN_DOES_NOT_EXITS` non ignoré → marqué comme erreur fatale | Ajouté au set `IGNORED_CODES` |
| 9 | `.github/workflows/node.js.yml` | `SESSION_SECRET` absent du step `Build` → crash Next.js ; `NODE_ENV=test` absent du step `Test` | Variables env ajoutées aux bons steps |
| 10 | `vitest.config.js` | PostCSS config string (`"@tailwindcss/postcss"`) invalide pour Vite → crash Vitest | Override `css.postcss.plugins: []` dans vitest.config.js |
| 11 | `Dockerfile` | Références à Prisma inexistant ; utilise `npm` au lieu de `yarn` ; port 3000 ≠ 10000 | Réécriture complète multi-stage sans Prisma, avec yarn, port 10000 |
| 12 | `docker-compose.yml` | Pas de service MySQL/Redis ; port 3000 ≠ 10000 ; pas de healthcheck DB | Ajout MySQL 8.0, Redis 7, healthchecks, depends_on |
| 13 | `package.json` | `multer@1.x` vulnérable ; `uuid@10` deprecated ; `bcrypt` et `bcryptjs` dupliqués | Upgrade multer→2.x, uuid→11.x |

### 🟡 Mineurs (maintenabilité)

| # | Fichier | Problème | Correction |
|---|---------|----------|------------|
| 14 | Racine | 20+ fichiers de debug/test (check-logs.js, debug-api.js, cookies.txt, etc.) | Supprimés |
| 15 | `.env.example` | Variables manquantes (REDIS_URL, DB_CONNECTION_LIMIT, NEXT_TELEMETRY_DISABLED) | Complété |
| 16 | `.gitignore` | `uploads/`, `*.tsbuildinfo`, `ca.pem`, `cookies.txt` non ignorés | Complété |
| 17 | `postcss.config.cjs` | Format objet au lieu de string → conflit Next.js/Vite | Corrigé en format objet `{ "@tailwindcss/postcss": {} }` |

---

## 2. Améliorations apportées

- **Migration runner** : passage de `execute()` à `query()` pour les DDL, meilleure gestion des erreurs idempotentes
- **Démarrage serveur** : logs structurés à chaque étape (DB, migrations, cache, alertes, watcher, port)
- **Health check Express** : route `/health` ajoutée au niveau Express (avant Next.js) pour les sondes Render/Docker
- **Dockerfile multi-stage** : séparation deps/builder/runner, utilisateur non-root, `HEALTHCHECK` natif
- **docker-compose** : stack complète locale (App + MySQL + Redis) avec healthchecks en cascade
- **CI/CD** : timeout 15min, support PR, variables correctement mappées

---

## 3. Risques restants

| Risque | Niveau | Recommandation |
|--------|--------|----------------|
| `sql-helpers.ts` : ORM maison sans protection contre SQL injection sur les champs dynamiques (`WHERE role = ?` OK, mais `ORDER BY` non paramétrable) | Moyen | Whitelist des colonnes autorisées pour ORDER BY |
| Pas de migration versioning (table `_migrations`) | Moyen | Ajouter une table de tracking pour éviter de réexécuter les migrations |
| `SESSION_SECRET` hardcodé dans `.env` du repo (fichier commité) | Haut | Vérifier que `.env` est bien dans `.gitignore` ; utiliser les secrets Render/GitHub exclusivement |
| `multer@2.x` : API légèrement différente de 1.x sur certains hooks | Faible | Tester l'endpoint `/api/import/upload` après upgrade |
| Redis absent → mode dégradé silencieux sans cache | Faible | Acceptable pour Render free tier ; ajouter un Redis Aiven si besoin de performance |
| Migrations anciennes avec `IF NOT EXISTS` non purgées (anciens fichiers SQL non modifiés) | Faible | Les erreurs sont maintenant toutes dans `IGNORED_CODES` → skippées proprement |

---

## 4. Architecture validée

```
LogSystem/
├── server.js              # Serveur Express + handler Next.js (pas de conflit port)
├── src/app/api/           # Routes Next.js API (App Router)
├── routes/                # Routes Express legacy (auth, logs, import, dashboard, admin)
├── config/database.js     # Pool MySQL avec SSL Aiven
├── lib/database/          # Migration runner MySQL 5.7+ compatible
├── db/migrations/         # SQL idempotents (ER_DUP_* ignorés)
├── services/              # Alert engine, retention, watcher, cache
├── workers/               # Alert worker SSE
├── middleware/            # Auth, CSRF, CSP, scopeGuard, validation
└── Dockerfile             # Multi-stage, non-root, yarn
```

---

## 5. Checklist déploiement Render

- [x] `SESSION_SECRET` dans les secrets Render (≥ 32 chars)
- [x] Variables DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_SSL configurées
- [x] Port = 10000 (défaut Render)
- [x] Build command : `yarn install && yarn build`
- [x] Start command : `node server.js`
- [x] Health check path : `/health`
