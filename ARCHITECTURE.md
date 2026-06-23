# LogSystem Architecture

Ce document doit etre mis a jour a chaque changement de structure. Une doc fausse est pire que pas de doc.

## Vue D'ensemble

LogSystem est une application Express avec une interface HTML/CSS/JavaScript vanilla servie depuis `public/`.
Le backend expose des routes API sous `routes/`, utilise MySQL via `mysql2`, et traite les logs dans `lib/processing/`.

Il n'y a pas de Next.js, React, Prisma, Tailwind, Radix UI ou dossier `src/` dans l'architecture actuelle.

## Arborescence

- `server.js`: point d'entree Express, session, securite, CSRF, routes, demarrage des workers.
- `config/`: configuration base de donnees, logger et niveaux de logs.
- `middleware/`: authentification, CSRF, audit, validation, CSP HTML et garde de scope utilisateur.
- `routes/`: routes API principales (`auth`, `logs`, `import`, `dashboard`, `admin`) et recherche sous `routes/api/`.
- `services/`: alertes, cache, retention, watcher temps reel et analyse.
- `workers/`: diffusion et evaluation asynchrone des alertes.
- `lib/processing/`: detection de format, parsing, extraction d'archives, normalisation, classification et empreintes.
- `lib/database/`: runner de migrations SQL.
- `db/schema.sql`: schema initial applique par le runner comme migration virtuelle `000_initial_schema.sql`.
- `db/migrations/`: migrations SQL appliquees dans l'ordre alphabetique.
- `public/`: pages HTML, CSS, JS client et assets statiques.
- `scripts/`: scripts de setup, maintenance et outils admin.
- `tests/`: tests Vitest de securite et de chemins critiques.

## Flux D'import

`routes/import.js` recoit les fichiers via Multer sur disque temporaire, calcule le hash SHA-256 en flux, cree un `import_job`, puis lance le traitement asynchrone.
Le traitement applicatif parse encore les contenus via des `Buffer`; les gros imports RAR doivent donc etre surveilles jusqu'a une refonte complete en streaming extraction -> parsing -> insertion.

Les archives sont gerees dans `lib/processing/archiveHandler.js` avec support ZIP, GZIP, TAR, TAR.GZ, RAR et 7z. RAR utilise d'abord `node-unrar-js`, puis un binaire systeme compatible (`unrar`, `7z` ou `RAR_EXTRACTOR`) en fallback.

## Donnees

MySQL est la base principale. Le runner applique:

1. `db/schema.sql`
2. tous les fichiers `.sql` actifs de `db/migrations/`

Les erreurs de migration de type "table/colonne/index deja existant" peuvent etre ignorees pour permettre des migrations idempotentes. Les erreurs "table inexistante" doivent echouer et etre corrigees.

## Frontend

Les pages utilisateur sont dans `public/`:

- `login.html`
- `dashboard.html`
- `search.html`
- `import.html`
- `watchlog.html`
- `admin.html`

Le responsive commun vit dans `public/css/responsive.css` et doit etre inclus par chaque page applicative.

## Securite

Les secrets obligatoires sont `SESSION_SECRET` et `CSRF_SECRET`.
`config/loadEnv.js` est importe en premier dans `server.js` et les scripts de setup afin que les modules ESM qui lisent `process.env` au chargement (ex. `middleware/csrf.js`) voient les variables du fichier `.env` local.

Les donnees sont scopees par utilisateur via `userScope` et `scopeGuard`. Les actions sensibles doivent appeler `recordAudit()`.

## Deploiement — Option A (hybride, recommandee)

Decision retenue : **Vercel pour le frontend et les API rapides** ; **service always-on (Render/Railway) pour les composants stateful**.

| Composant | Vercel | Always-on |
|---|---|---|
| Pages HTML statiques + login/search/dashboard | Oui | Oui |
| Watch Log SSE (`/api/logs/watch/stream`) | Non | Oui |
| Alert push SSE (`/api/alerts/stream`) | Non | Oui |
| File watcher (`services/watcherService.js`) | Non | Oui |
| Alert engine + retention (`setInterval`) | Non | Oui |
| Import RAR volumineux (> 4,5 Mo) | Non | Oui |

Sur Vercel, `START_BACKGROUND_JOBS=false` est force via `vercel.json`. Le handler serverless exporte `server.js` sans `.listen()`.

Redis : utiliser Upstash (compatible Vercel) plutot que Render Key Value (reseau prive Render).

Pool MySQL serverless : `DB_CONNECTION_LIMIT=2` recommande sur Vercel.

Voir `DEV_PROD_SETUP.md` et `vercel.json` pour la configuration detaillee.
