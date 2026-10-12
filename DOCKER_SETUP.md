# 🐳 Docker Setup Guide - LogSystem

Ce guide explique comment configurer et exécuter LogSystem avec Docker Compose.

## 📋 Prérequis

- Docker Desktop installé ([https://www.docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop))
- PowerShell (sur Windows) ou Bash (sur Linux/Mac)
- Au moins 4GB de RAM disponibles pour Docker

## 🚀 Démarrage Rapide

### 1. Cloner le repository (si pas déjà fait)

```bash
git clone <repository-url>
cd LogSystem
```

### 2. Lancer le setup automatique

```powershell
.\docker-setup.ps1
```

Ce script va:
- ✅ Vérifier que Docker est installé
- ✅ Construire les images Docker
- ✅ Démarrer MySQL, Redis et l'application
- ✅ Attendre que les services soient prêts
- ✅ Tester la connexion à l'application

### 3. Accéder à l'application

Ouvrez votre navigateur sur: **http://localhost:10000**

Identifiants par défaut:
- **Admin**: admin@logsystem.local / Admin@1234
- **User**: user@logsystem.local / User@1234

## 📁 Structure Docker

```
LogSystem/
├── Dockerfile              # Image de l'application
├── docker-compose.yml     # Orchestration des services
├── .env.docker            # Configuration Docker
├── docker-setup.ps1       # Script de setup
├── docker-stop.ps1        # Script d'arrêt
├── docker-logs.ps1        # Script de logs
├── docker-reset.ps1       # Script de reset
└── docker-shell.ps1       # Script d'accès shell
```

## 🔧 Services Docker

L'application utilise 3 conteneurs:

### 1. **app** (LogSystem)
- Port: 10000
- Dépend: mysql, redis
- Healthcheck: HTTP /health
- Volumes: uploads, logs, temp

### 2. **mysql** (MySQL 8.0)
- Port: 3306 (interne)
- Database: logsystem
- Volume: logsystem-mysql
- Init: schema.sql + migrations

### 3. **redis** (Redis 7)
- Port: 6379 (interne)
- Volume: logsystem-redis
- Persistence: AOF enabled

## 📝 Scripts Utilitaires

### docker-setup.ps1
Configure et lance tous les services Docker.

```powershell
.\docker-setup.ps1
```

### docker-stop.ps1
Arrête les services sans supprimer les données.

```powershell
.\docker-stop.ps1
```

### docker-logs.ps1
Affiche les logs des services.

```powershell
# Tous les services
.\docker-logs.ps1

# Service spécifique
.\docker-logs.ps1 app
.\docker-logs.ps1 mysql
.\docker-logs.ps1 redis
```

### docker-reset.ps1
⚠️ **Attention**: Supprime tous les conteneurs et volumes (données perdues).

```powershell
.\docker-reset.ps1
```

### docker-shell.ps1
Accès au shell d'un conteneur.

```powershell
# Application shell
.\docker-shell.ps1 app

# MySQL client
.\docker-shell.ps1 mysql

# Redis CLI
.\docker-shell.ps1 redis
```

## 🔐 Configuration

Les variables d'environnement sont définies dans `.env.docker`:

### Database
```env
DB_HOST=mysql
DB_PORT=3306
DB_USER=logsystem
DB_PASSWORD=LogSystemDocker2024!
DB_NAME=logsystem
```

### Redis
```env
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=LogSystemRedis2024!
```

### Sécurité
```env
SESSION_SECRET=LogSystemSessionSecret2024DockerDeployment
CSRF_SECRET=LogSystemCSRFSecret2024DockerDeployment
```

⚠️ **Important**: Changez ces secrets en production!

## 🛠️ Commandes Docker Compose

### Démarrer les services
```bash
docker compose --env-file .env.docker up -d
```

### Arrêter les services
```bash
docker compose --env-file .env.docker down
```

### Voir l'état
```bash
docker compose --env-file .env.docker ps
```

### Voir les logs
```bash
docker compose --env-file .env.docker logs -f
docker compose --env-file .env.docker logs -f app
```

### Reconstruire les images
```bash
docker compose --env-file .env.docker build
docker compose --env-file .env.docker up -d
```

### Redémarrer un service
```bash
docker compose --env-file .env.docker restart app
```

## 🗄️ Base de Données

### Accéder à MySQL
```powershell
.\docker-shell.ps1 mysql
```

Ou directement:
```bash
docker compose --env-file .env.docker exec mysql mysql -u logsystem -p logsystem
```

### Sauvegarder la base de données
```bash
docker compose --env-file .env.docker exec mysql mysqldump -u logsystem -p logsystem > backup.sql
```

### Restaurer la base de données
```bash
docker compose --env-file .env.docker exec -T mysql mysql -u logsystem -p logsystem < backup.sql
```

## 🔄 Mises à jour

### Mettre à jour l'application
```powershell
# Arrêter
.\docker-stop.ps1

# Pull les changements
git pull

# Reconstruire et démarrer
docker compose --env-file .env.docker build
docker compose --env-file .env.docker up -d
```

### Mettre à jour uniquement le code (sans rebuild)
```bash
docker compose --env-file .env.docker up -d --build app
```

## 🐛 Dépannage

### L'application ne démarre pas

1. Vérifier les logs:
   ```powershell
   .\docker-logs.ps1 app
   ```

2. Vérifier l'état des services:
   ```bash
   docker compose --env-file .env.docker ps
   ```

3. Vérifier que les ports ne sont pas utilisés:
   ```bash
   netstat -ano | findstr :10000
   ```

### MySQL ne se connecte pas

1. Vérifier que MySQL est healthy:
   ```bash
   docker compose --env-file .env.docker ps mysql
   ```

2. Voir les logs MySQL:
   ```powershell
   .\docker-logs.ps1 mysql
   ```

3. Réinitialiser MySQL (attention: données perdues):
   ```powershell
   .\docker-reset.ps1
   ```

### Problèmes de permissions

Sur Linux/Mac, vous pourriez avoir des problèmes de permissions avec les volumes. Pour corriger:

```bash
docker compose --env-file .env.docker down
sudo rm -rf volumes/
docker compose --env-file .env.docker up -d
```

### Mémoire insuffisante

Si Docker manque de mémoire:

1. Ouvrir Docker Desktop
2. Settings → Resources
3. Augmenter la mémoire allouée (min 4GB)
4. Appliquer et redémarrer Docker

## 📊 Monitoring

### Voir l'utilisation des ressources
```bash
docker stats
```

### Voir l'espace disque utilisé
```bash
docker system df
```

### Nettoyer les ressources inutilisées
```bash
docker system prune -a
```

## 🔒 Sécurité en Production

Avant de déployer en production:

1. **Changer les secrets par défaut** dans `.env.docker`
2. **Utiliser des mots de passe forts** pour MySQL et Redis
3. **Configurer HTTPS** (utiliser un reverse proxy comme Nginx)
4. **Limiter l'accès réseau** (utiliser Docker networks)
5. **Activer les backups automatiques** de la base de données
6. **Surveiller les logs** pour les activités suspectes

## 📚 Ressources

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [LogSystem Documentation](./ARCHITECTURE.md)

## 💡 Astuces

### Démarrage rapide (développement)
```bash
docker compose --env-file .env.docker up -d app mysql redis
```

### Démarrer en mode foreground (voir les logs)
```bash
docker compose --env-file .env.docker up
```

### Exécuter une commande dans le conteneur
```bash
docker compose --env-file .env.docker exec app npm run create-admin
```

### Copier des fichiers vers le conteneur
```bash
docker cp test.log logsystem:/app/logs/
```

## 🆘 Support

En cas de problème:

1. Vérifier les logs: `.\docker-logs.ps1`
2. Vérifier la documentation: `./docs/`
3. Ouvrir une issue sur GitHub

---

**Version**: 6.0.0  
**Dernière mise à jour**: 2026-09-30
