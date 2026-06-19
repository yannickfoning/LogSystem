# Guide de Configuration DEV / PROD

Ce document explique comment configurer les environnements de développement local et de production pour LogSystem.

## Objectifs

- **Développement local** : MySQL local (`localhost:3306`), sans SSL.
- **Production always-on** (Render/Railway) : MySQL Aiven avec SSL, workers temps réel (SSE, watcher, alert engine).
- **Vercel (Option A — hybride)** : frontend + API légères uniquement ; workers et imports lourds restent sur le service always-on.

## 1. Variables d'environnement

Copiez `.env.example` vers `.env` à la racine du projet.

### Secrets obligatoires

Générez des secrets aléatoires (64 caractères recommandés) :

```bash
npm run secret
# ou
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Remplacez dans `.env` :

- `SESSION_SECRET` — minimum 32 caractères, **ne doit pas contenir** `change-me`
- `CSRF_SECRET` — minimum 32 caractères

### Base de données locale

```dotenv
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=votre_mot_de_passe
DB_NAME=logsystem
DB_SSL=false
```

Créez la base si nécessaire :

```sql
CREATE DATABASE IF NOT EXISTS logsystem CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

## 2. Démarrage local (sans étape manuelle SQL)

```bash
npm install
cp .env.example .env   # puis éditez les secrets et DB_PASSWORD
node server.js
```

Au premier démarrage sur une base **vide** :

1. Le runner applique `db/schema.sql` puis `db/migrations/*.sql`.
2. Les tables critiques sont vérifiées — le serveur refuse de démarrer si une table manque.
3. Créez les comptes par défaut : `npm run create-admin`

Comptes créés par `create-admin` (à changer après la première connexion) :

| Rôle | Email | Mot de passe |
|---|---|---|
| admin | admin@logsystem.local | Admin@1234 |
| user | user@logsystem.local | User@1234 |

## 3. Migrations

**Aucune exécution manuelle de SQL n'est requise.** Le `migrationRunner.js` s'exécute automatiquement au démarrage (`RUN_MIGRATIONS_ON_START=true` par défaut).

Voir `MIGRATION_SQL.md` pour la liste des fichiers SQL et le comportement du runner.

## 4. Production

### Service always-on (Render / Railway) — recommandé

Héberge l'application complète :

- Watch Log SSE (`/api/logs/watch/stream`)
- Alert worker (`/api/alerts/stream`)
- File watcher (`WATCH_DIRS`)
- Alert engine + retention scheduler
- Import de gros fichiers RAR

Variables identiques à `.env.example`, avec `DB_SSL=true` et les credentials Aiven.

### Vercel (Option A — API légère uniquement)

`vercel.json` désactive automatiquement les background jobs (`START_BACKGROUND_JOBS=false`).

**Limites Vercel :**

- Pas de SSE persistant (Watch Log / alertes push)
- Upload limité à ~4,5 Mo par requête
- Pas de file watcher

Configurez les variables dans le dashboard Vercel (voir section VERCEL dans `.env.example`).

## 5. Vérifications essentielles

- [ ] Log `[DB]` au démarrage sans erreur `[FATAL]`
- [ ] Aucune erreur `[MIGRATION]` non ignorée (sauf doublons bénins)
- [ ] `npm run create-admin` fonctionne
- [ ] Connexion admin et user testées
- [ ] CSRF actif sur les requêtes POST/PUT/DELETE

## 6. Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| `CSRF_SECRET must be set` | `.env` absent ou secret trop court | Vérifier `.env`, régénérer les secrets |
| `SESSION_SECRET must be at least 32 characters` | Secret manquant ou contient `change-me` | Régénérer et mettre à jour `.env` |
| `Tables manquantes après migrations` | MySQL inaccessible ou migrations en échec | Vérifier credentials, logs `[MIGRATION]` |
| `create-admin` échoue | Migrations non appliquées | Démarrer `node server.js` une fois d'abord |
