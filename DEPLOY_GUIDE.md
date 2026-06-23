# Guide de deploiement LogSystem

Ce guide est adapte a cette plateforme: application Node.js/Express, base MySQL compatible, sessions stockees en base, cache Redis optionnel, import de logs et traitement d'archives `.zip`, `.gz`, `.tar`, `.tgz` et `.rar`.

## 1. Prerequis

- Node.js 18 ou plus recent
- npm 8 ou plus recent
- MySQL 8, MariaDB compatible, ou TiDB Cloud
- Redis optionnel pour le cache
- Un outil RAR si l'import `.rar` doit fonctionner:
  - Linux: `unrar` ou `p7zip-full`
  - Windows: 7-Zip installe et accessible dans le `PATH`, ou variable `RAR_EXTRACTOR`
  - Docker/Render: installer `unrar` ou `7z` dans l'image

## 2. Installation locale ou VPS

```bash
npm install
cp .env.example .env
node scripts/tools/generate-secret.js
```

Renseigner ensuite `.env`:

```env
NODE_ENV=production
PORT=3001
SESSION_SECRET=remplacer-par-un-secret-de-32-caracteres-minimum
CSRF_SECRET=remplacer-par-un-secret-de-32-caracteres-minimum

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=logsystem
DB_PASSWORD=mot-de-passe-fort
DB_NAME=logsystem
DB_CONNECTION_LIMIT=20
DB_SSL=false

UPLOAD_MAX_SIZE=52428800
IMPORT_BATCH_SIZE=2000

REDIS_URL=
WATCH_DIRS=./logs
RETENTION_CRON_HOUR=3
ALERT_EVAL_INTERVAL=60000
ERROR_RETURN_GAP_DAYS=7

# Optionnel: chemin explicite si la commande n'est pas dans le PATH.
# Exemple Windows: C:\Program Files\7-Zip\7z.exe
RAR_EXTRACTOR=
```

Creer la base puis appliquer le schema:

```bash
mysql -u root -p -e "CREATE DATABASE logsystem DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
npm run schema
```

Demarrer:

```bash
npm start
```

## 3. Support des fichiers RAR

Le code accepte maintenant les fichiers `.rar`, les detecte par extension ou signature, puis tente l'extraction avec `unrar` et, en secours, `7z`.

Installation Linux:

```bash
sudo apt update
sudo apt install -y unrar
```

Alternative Linux avec 7-Zip:

```bash
sudo apt update
sudo apt install -y p7zip-full
```

Installation Windows:

1. Installer 7-Zip.
2. Ajouter le dossier de 7-Zip au `PATH`, par exemple `C:\Program Files\7-Zip`.
3. Ou definir `RAR_EXTRACTOR=C:\Program Files\7-Zip\7z.exe`.

Test rapide:

```bash
unrar
7z
npm test
```

Puis tester via l'interface `/import.html` avec une archive `.rar` contenant des fichiers `.log`, `.txt`, `.json`, `.jsonl`, `.csv` ou `.xml`.

## 4. Deploiement Render + TiDB Cloud

Render peut deployer l'application Node directement, mais le support `.rar` exige un binaire systeme. Pour garder l'import `.rar`, le plus fiable est un deploiement Docker sur Render avec `unrar` ou `7z` installe dans l'image. Sans Docker, Render peut demarrer l'application, mais l'extraction `.rar` dependra des binaires disponibles dans l'environnement.

Variables Render recommandees:

```env
NODE_ENV=production
PORT=3001
SESSION_SECRET=secret-long-genere
CSRF_SECRET=secret-long-genere

DB_HOST=xxxxx.tidbcloud.com
DB_PORT=4000
DB_USER=logsystem
DB_PASSWORD=mot-de-passe-tidb
DB_NAME=logsystem
DB_CONNECTION_LIMIT=20
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=true

UPLOAD_MAX_SIZE=52428800
IMPORT_BATCH_SIZE=2000
REDIS_URL=
WATCH_DIRS=/tmp/logs
ERROR_RETURN_GAP_DAYS=7
ALERT_EVAL_INTERVAL=60000
```

Build command:

```bash
npm install
```

Start command:

```bash
npm start
```

Avant le premier demarrage, creer la base `logsystem` dans TiDB Cloud. Au demarrage, l'application lance les migrations disponibles via `lib/database/migrationRunner.js`.

## 5. Deploiement avec PM2 sur VPS

```bash
npm install -g pm2
npm install --omit=dev
npm run schema
pm2 start server.js --name logsystem
pm2 save
pm2 startup
```

Commandes utiles:

```bash
pm2 logs logsystem
pm2 restart logsystem
pm2 status
```

Mettre Nginx devant l'application:

```nginx
server {
  listen 80;
  server_name votre-domaine.com;

  location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

Activer ensuite HTTPS avec Certbot.

## 6. Verification apres deploiement

```bash
curl -I https://votre-domaine.com/
```

Verifier dans les logs:

- connexion base de donnees reussie
- migrations terminees ou deja appliquees
- cache Redis actif ou mode degrade sans cache
- watcher demarre si `WATCH_DIRS` est configure

Tester les parcours critiques:

1. Connexion utilisateur.
2. Import d'un fichier `.log`.
3. Import d'une archive `.zip`.
4. Import d'une archive `.rar`.
5. Consultation du dashboard.
6. Recherche de logs.
7. Verification des alertes et groupes d'erreurs.

## 7. Sauvegardes et maintenance

Sauvegarde MySQL:

```bash
mysqldump -h $DB_HOST -P $DB_PORT -u $DB_USER -p$DB_PASSWORD $DB_NAME > backup-logsystem.sql
```

Surveiller regulierement:

- taille de la table `logs`
- temps de reponse du dashboard
- erreurs d'import
- espace disque du dossier `logs`
- validite du certificat HTTPS
- presence de `unrar` ou `7z` apres mise a jour serveur

## 8. Depannage

Erreur `No working RAR extractor found`:

- installer `unrar` ou `7z`
- verifier que la commande est dans le `PATH`
- ou definir `RAR_EXTRACTOR` avec le chemin complet

Erreur de connexion TiDB:

- verifier `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- definir `DB_SSL=true`
- si un certificat CA est impose, definir `DB_SSL_CA_PATH` ou `DB_SSL_CA`

Import trop volumineux:

- augmenter `UPLOAD_MAX_SIZE`
- verifier la taille decompressee de l'archive
- augmenter prudemment la memoire du service si les imports sont massifs

Sessions qui disparaissent:

- verifier que `SESSION_SECRET` est stable
- verifier que la table de session est accessible
- en production, utiliser HTTPS car les cookies sont securises
