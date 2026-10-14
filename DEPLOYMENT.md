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

## Déploiement sur Render

1. Créez une base de données MySQL managée (Aiven, AWS RDS, etc.)
2. Push le code sur GitHub
3. Connectez votre dépôt Render
4. Configurez les variables d'environnement dans le dashboard Render :
   - `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
   - `DB_SSL=true`
   - `DB_SSL_CA_PATH` (si requis)
   - `SESSION_SECRET`, `CSRF_SECRET` (générés automatiquement ou manuellement)
5. Déployez

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
