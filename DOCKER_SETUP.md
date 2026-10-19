# Configuration Docker pour LogSystem avec MySQL

Ce guide explique comment démarrer LogSystem avec Docker Compose en utilisant MySQL comme base de données.

Cette configuration est optimisée pour le déploiement sur Render, qui utilise MySQL nativement.

## Prérequis

1. **Docker Desktop** installé
   - Téléchargez depuis https://www.docker.com/products/docker-desktop
   - Version 20.10+ requise

2. **Git** (optionnel, pour cloner le dépôt)

## Architecture Docker

L'application utilise 3 conteneurs :

- **logsystem** : Application Node.js (Express)
- **logsystem-mysql** : Base de données MySQL 8.0
- **logsystem-redis** : Cache Redis (optionnel, pour la performance)

## Démarrage rapide

### Windows

```batch
docker-start.bat
```

### Linux/macOS

```bash
chmod +x docker-start.sh
./docker-start.sh
```

Ou manuellement :

```bash
docker compose up -d
```

## Configuration

### Variables d'environnement

Les variables sont définies dans `docker-compose.yml` :

```yaml
DB_HOST=mysql
DB_PORT=3306
DB_USER=logsystem
DB_PASSWORD=LogSystem2024!
DB_NAME=logsystem
```

**⚠️ IMPORTANT** : Changez les mots de passe par défaut en production !

### Modifier les mots de passe

1. Éditez `docker-compose.yml`
2. Modifiez les variables :
   - `MYSQL_ROOT_PASSWORD`
   - `MYSQL_PASSWORD`
   - `DB_PASSWORD`
   - `REDIS_PASSWORD`
   - `SESSION_SECRET`
   - `CSRF_SECRET`

3. Recréez les conteneurs :
   ```bash
   docker compose down
   docker compose up -d
   ```

## Initialisation de la base de données

La base de données est automatiquement initialisée au premier démarrage :

- Le fichier `db/schema.sql` est exécuté
- Les migrations dans `db/migrations/` sont appliquées

### Initialisation manuelle

Si nécessaire :

```bash
# Windows
docker exec -it logsystem-mysql mysql -u root -pLogSystem2024! logsystem

# Linux/macOS
docker exec -it logsystem-mysql mysql -u root -pLogSystem2024! logsystem
```

Puis dans MySQL :

```sql
-- Vérifier la base de données
SHOW DATABASES;
USE logsystem;
SHOW TABLES;
```

## Créer l'utilisateur admin

Exécutez le script de création des comptes par défaut après la première migration :

Par défaut :
- Email : `admin@logsystem.local`
- Mot de passe : `CHANGE_THIS_STRONG_PASSWORD_IMMEDIATELY`

**⚠️ Changez immédiatement ce mot de passe après la première connexion !**

### Créer un admin manuellement

```bash
docker exec -it logsystem node scripts/setup/create-default-users.js
```

## Commandes Docker utiles

### Voir les logs

```bash
# Tous les services
docker compose logs -f

# Un service spécifique
docker compose logs -f logsystem
docker compose logs -f mysql
docker compose logs -f redis
```

### Arrêter les services

```bash
docker compose down
```

### Redémarrer les services

```bash
docker compose restart
```

### Reconstruire les images

```bash
docker compose down
docker compose build
docker compose up -d
```

### Accéder à MySQL

```bash
docker exec -it logsystem-mysql mysql -u root -pLogSystem2024!
```

### Accéder à Redis

```bash
docker exec -it logsystem-redis redis-cli -a LogSystemRedis2024!
```

### Nettoyer tout (données incluses)

```bash
docker compose down -v
```

⚠️ Cela supprime toutes les données !

## Volumes Docker

Les données sont persistées dans les volumes suivants :

- `logsystem-mysql` : Données MySQL
- `logsystem-redis` : Données Redis
- `logsystem-uploads` : Fichiers uploadés
- `logsystem-logs` : Logs de l'application
- `logsystem-temp` : Fichiers temporaires

### Lister les volumes

```bash
docker volume ls
```

### Sauvegarder les volumes

```bash
# Sauvegarder MySQL
docker run --rm -v logsystem-mysql:/data -v $(pwd):/backup alpine tar czf /backup/mysql-backup.tar.gz /data

# Restaurer MySQL
docker run --rm -v logsystem-mysql:/data -v $(pwd):/backup alpine sh -c "cd /data && tar xzf /backup/mysql-backup.tar.gz --strip 1"
```

## Accès à l'application

Une fois démarré, accédez à :

- **Application** : http://localhost:10000
- **Dashboard** : http://localhost:10000/dashboard.html
- **Login** : http://localhost:10000/login.html

## Ports utilisés

- **10000** : Application Node.js
- **3306** : MySQL (interne au réseau Docker)
- **6379** : Redis (interne au réseau Docker)

Pour accéder à MySQL depuis l'hôte, ajoutez dans `docker-compose.yml` :

```yaml
mysql:
  ports:
    - "3306:3306"
```

## Dépannage

### Les conteneurs ne démarrent pas

```bash
# Voir les logs
docker compose logs

# Vérifier l'état
docker compose ps
```

### Erreur de connexion à MySQL

1. Vérifiez que MySQL est prêt :
   ```bash
   docker exec logsystem-mysql mysqladmin ping -h localhost -u root -pLogSystem2024!
   ```

2. Vérifiez les logs MySQL :
   ```bash
   docker compose logs mysql
   ```

### Erreur de connexion Redis

1. Vérifiez que Redis est prêt :
   ```bash
   docker exec logsystem-redis redis-cli -a LogSystemRedis2024! ping
   ```

### L'application ne démarre pas

1. Vérifiez les logs de l'application :
   ```bash
   docker compose logs logsystem
   ```

2. Vérifiez que Node.js a réussi à se connecter à MySQL

3. Recréez les conteneurs :
   ```bash
   docker compose down
   docker compose up -d
   ```

### Port déjà utilisé

Si le port 10000 est déjà utilisé :

1. Modifiez le port dans `docker-compose.yml` :
   ```yaml
   app:
     ports:
       - "8080:10000"
   ```

2. Ou arrêtez le service utilisant le port 10000

### Mémoire insuffisante

Docker Desktop a besoin de 4GB+ de RAM. Configurez dans Docker Desktop :

1. Settings → Resources → Memory
2. Augmentez à 4GB ou plus
3. Appliquez et redémarrez Docker

## Mise à jour

Pour mettre à jour l'application :

```bash
git pull
docker compose down
docker compose build
docker compose up -d
```

## Production

Pour un déploiement en production :

1. Changez tous les mots de passe par défaut
2. Utilisez des secrets Docker ou un gestionnaire de secrets
3. Activez HTTPS (configurez un reverse proxy comme Nginx)
4. Configurez les backups automatiques
5. Surveillez les logs et les métriques
6. Configurez les limites de ressources

### Exemple de configuration Nginx (reverse proxy)

```nginx
server {
    listen 80;
    server_name logsystem.example.com;

    location / {
        proxy_pass http://localhost:10000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Déploiement sur Render (Docker)

Render peut construire et lancer **uniquement le conteneur applicatif** défini par le `Dockerfile` (pas le `docker-compose` complet). MySQL reste **externe** (Aiven, PlanetScale, instance managée, etc.).

### Prérequis Render

1. Dépôt Git connecté à Render.
2. Blueprint `render.yaml` à la racine (déjà configuré avec `runtime: docker`).
3. Variables secrètes dans le dashboard Render :
   - `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
   - `DB_SSL=true` et `DB_SSL_CA_BASE64` (certificat CA Aiven en base64, une ligne)
   - `SESSION_SECRET` et `CSRF_SECRET` (générés par le blueprint ou définis manuellement)
4. Service **Key Value** `logsystem-cache` pour `REDIS_URL` (optionnel mais recommandé).

### Étapes

1. **New → Blueprint** (ou mettre à jour le service existant) et appliquer `render.yaml`.
2. Vérifier que le service web est en **Docker** (pas « Native Environment »).
3. Au premier déploiement réussi, exécuter une **one-off shell** sur Render :
   ```bash
   node scripts/setup/create-default-users.js
   ```
4. Contrôler `/health` : réponse `{ "status": "ok", "database": "ok" }`.

### Limites Render + Docker

| Comportement | Détail |
|--------------|--------|
| Watcher fichiers | Désactivé (`RENDER=true`) — pas de disque persistant pour `./logs` |
| Port | Render injecte `PORT` ; l’image expose `10000` par défaut (`render.yaml` aligné) |
| Health check | `/health` doit répondre 200 avec MySQL joignable |
| Uploads | Volume éphémère — les fichiers importés sont en base, pas sur disque long terme |

### Build local (validation avant push)

```bash
docker build -t logsystem:local .
docker run --rm -p 10000:10000 --env-file .env.docker.example logsystem:local
```

Adaptez `.env.docker.example` → `.env` local avec vos identifiants MySQL.

## Ressources

- Documentation Docker : https://docs.docker.com/
- Render Docker : https://render.com/docs/docker
- Documentation Docker Compose : https://docs.docker.com/compose/
- Documentation MySQL : https://dev.mysql.com/doc/
