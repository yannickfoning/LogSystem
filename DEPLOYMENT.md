# Guide de Déploiement - LogSystem

Ce guide explique comment déployer LogSystem en production.

## Prérequis

- Docker et Docker Compose installés
- Domaine configuré avec DNS
- Certificat SSL/TLS (Let's Encrypt recommandé)
- Reverse proxy (Nginx ou Traefik) pour HTTPS

## Étape 1 : Configuration des secrets

### Génération des secrets

```bash
# Générer des secrets sécurisés (Linux/Mac/Windows avec Git Bash)
openssl rand -base64 32
```

Générez 4 secrets différents :
1. `MYSQL_ROOT_PASSWORD` - Mot de passe root MySQL
2. `MYSQL_PASSWORD` - Mot de passe utilisateur logsystem
3. `REDIS_PASSWORD` - Mot de passe Redis
4. `SESSION_SECRET` - Secret sessions
5. `CSRF_SECRET` - Secret CSRF

### Configuration de l'environnement

```bash
# Copier le template
cp .env.production.example .env.production

# Éditer et remplacer tous les mots de passe
nano .env.production
```

## Étape 2 : Configuration MySQL (Option A - Docker)

Si vous utilisez Docker MySQL :

```bash
# Démarrer avec l'environnement de production
docker compose --env-file .env.production up -d
```

Le script `db/schema.sql` sera exécuté automatiquement au premier démarrage.

## Étape 2bis : Configuration MySQL (Option B - Base managée)

Si vous utilisez une base de données managée (Aiven, AWS RDS, etc.) :

### 1. Exécuter le script de configuration

```bash
mysql -h <db-host> -u root -p < db/production-config.sql
```

### 2. Configurer les variables d'environnement

```bash
# Dans .env.production
DB_HOST=votre-db-host
DB_PORT=3306
DB_USER=logsystem
DB_PASSWORD=votre_mot_de_passe_généré
DB_NAME=logsystem
DB_SSL=true
DB_SSL_CA_PATH=/path/to/ca.pem  # Si requis
```

### 3. Exécuter les migrations

```bash
docker compose --env-file .env.production run app npm start
```

## Étape 3 : Configuration Reverse Proxy

### Nginx

Créez `/etc/nginx/sites-available/logsystem` :

```nginx
server {
    listen 80;
    server_name votre-domaine.com;

    # Redirection vers HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name votre-domaine.com;

    # Certificat SSL
    ssl_certificate /etc/letsencrypt/live/votre-domaine.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/votre-domaine.com/privkey.pem;

    # Headers de sécurité
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Proxy vers l'application
    location / {
        proxy_pass http://localhost:10000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # SSE pour les alertes en temps réel
    location /api/alerts/stream {
        proxy_pass http://localhost:10000;
        proxy_set_header Connection '';
        proxy_buffering off;
        chunked_transfer_encoding off;
    }
}
```

Activer la configuration :

```bash
sudo ln -s /etc/nginx/sites-available/logsystem /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Certificat SSL avec Let's Encrypt

```bash
sudo certbot --nginx -d votre-domaine.com
```

## Étape 4 : Déploiement

```bash
# Arrêter les conteneurs existants
docker compose down

# Démarrer avec l'environnement de production
docker compose --env-file .env.production up -d

# Vérifier les logs
docker compose logs -f
```

## Étape 5 : Vérification

```bash
# Vérifier le healthcheck
curl https://votre-domaine.com/health

# Devrait retourner:
# {"status":"ok","database":"ok","timestamp":"...","uptime":...}
```

## Étape 6 : Créer l'utilisateur admin

```bash
docker compose --env-file .env.production exec app npm run create-admin
```

Par défaut :
- Email : `admin@logsystem.local`
- Mot de passe : `CHANGE_THIS_STRONG_PASSWORD_IMMEDIATELY`

**IMPORTANT : Changez ce mot de passe immédiatement après la première connexion.**

## Étape 7 : Configuration des backups

### Backup MySQL

```bash
# Script de backup automatique (cron)
0 3 * * * docker exec logsystem-mysql mysqldump -u logsystem -p$MYSQL_PASSWORD logsystem > /backup/logsystem_$(date +\%Y\%m\%d).sql
```

### Backup volumes Docker

```bash
# Backup des volumes
docker run --rm -v logsystem-mysql:/data -v /backup:/backup alpine tar czf /backup/mysql-$(date +%Y%m%d).tar.gz /data
```

## Étape 8 : Monitoring

### Vérifier les logs

```bash
# Logs application
docker compose logs -f app

# Logs MySQL
docker compose logs -f mysql

# Logs Redis
docker compose logs -f redis
```

### Monitoring des ressources

```bash
# Statistiques des conteneurs
docker stats
```

## Déploiement sur Render (Plan Gratuit)

### Architecture recommandée
- **App Node** : Render Web Service Free (mise en veille après 15 min sans trafic)
- **MySQL** : Aiven for MySQL Free (1 CPU, 1 Go RAM, 1 Go disque)
- **Redis** : Render Key Value Free (cache optionnel)
- **Anti-veille** : UptimeRobot (ping `/health` toutes les 5 min)

### Étape 1 : Créer la base Aiven MySQL

1. Allez sur [aiven.io](https://aiven.io)
2. Créez un compte gratuit (sans carte bancaire)
3. Créez un service "Aiven for MySQL" avec le plan Free
4. Notez les informations de connexion :
   - Hôte (ex: `mysql-xxx.aivencloud.com`)
   - Port (ex: `21661`)
   - Utilisateur (ex: `avnadmin`)
   - Mot de passe
   - Nom de la base (ex: `defaultdb`)
5. Téléchargez le certificat CA depuis "Connection information"

### Étape 2 : Encoder le certificat CA

**Linux/macOS :**
```bash
base64 -i ca.pem | tr -d '\n'
```

**PowerShell :**
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("ca.pem"))
```

Conservez cette chaîne base64.

### Étape 3 : Déployer sur Render

1. Push le code sur GitHub
2. Connectez votre dépôt Render
3. Créez un "New Blueprint" ou utilisez `render.yaml`
4. Configurez les variables d'environnement :
   - `DB_HOST` : hôte Aiven
   - `DB_PORT` : port Aiven
   - `DB_USER` : utilisateur Aiven
   - `DB_PASSWORD` : mot de passe Aiven
   - `DB_NAME` : nom de la base
   - `DB_SSL=true`
   - `DB_SSL_CA_BASE64` : votre certificat encodé en base64
   - `DB_SSL_REJECT_UNAUTHORIZED=true`
   - `SESSION_SECRET` : généré automatiquement
   - `CSRF_SECRET` : généré automatiquement
5. Déployez

### Étape 4 : Créer l'admin (depuis votre PC)

Le plan gratuit n'a pas de shell SSH. Créez l'admin localement :

```bash
# Configurez .env local avec les creds Aiven
DB_HOST=mysql-xxx.aivencloud.com
DB_PORT=21661
DB_USER=avnadmin
DB_PASSWORD=votre_mot_de_passe
DB_NAME=defaultdb
DB_SSL=true
DB_SSL_CA_PATH=/path/to/ca.pem

# Lancez la création d'admin
npm run create-admin
```

Changez ensuite les mots de passe par défaut depuis l'interface.

### Étape 5 : Configurer UptimeRobot

1. Créez un compte gratuit sur [uptimerobot.com](https://uptimerobot.com)
2. Ajoutez un nouveau monitor
3. Type : HTTP(s)
4. URL : `https://votre-app.onrender.com/health`
5. Interval : 5 minutes
6. Activez le monitor

### Limites du plan gratuit

- **Mise en veille** : Le service s'endort après 15 min sans trafic (réveil ~1 min)
- **Moteur d'alertes** : Ne tourne que si le service est éveillé
- **SSE** : Les connexions sont coupées au redémarrage
- **Disque** : 1 Go sur Aiven (configurez une rétention courte)
- **Fichiers locaux** : Perdus à chaque redémarrage (utilisez l'upload)
- **RAR** : `unrar` système peut ne pas être disponible (testez après déploiement)
- **RAM** : 512 Mo (limites d'upload réduites à 200 Mo)

### Pour éviter la mise en veille

Si vous voulez éviter ces limitations, passez au plan Render Starter (7$/mois) en changeant `plan: free` → `plan: starter` dans `render.yaml`.

## Sécurité

- [ ] Tous les mots de passe sont forts et uniques
- [ ] HTTPS est activé
- [ ] Le firewall restreint l'accès aux ports non nécessaires
- [ ] Les backups automatiques sont configurés
- [ ] Le monitoring est actif
- [ ] Les logs sont centralisés
- [ ] Le rate limiting est actif
- [ ] Les secrets ne sont pas versionnés

## Support

En cas de problème :
1. Vérifiez les logs : `docker compose logs -f`
2. Vérifiez le healthcheck : `curl http://localhost:10000/health`
3. Consultez la documentation dans `docs/`
