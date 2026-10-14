# LogSystem

Plateforme de gestion et monitoring de logs pour MySQL 8.

## Prérequis

- Node.js 22.x
- MySQL 8.0+
- Redis (optionnel, pour le cache)

## Installation

### 1. Cloner le dépôt

```bash
git clone <repository-url>
cd LogSystem
```

### 2. Installer les dépendances

```bash
npm install
```

### 3. Configurer l'environnement

```bash
cp .env.example .env
```

Éditez `.env` avec vos credentials MySQL. Voir la section [Variables d'environnement](#variables-d-environnement).

### 4. Initialiser la base de données

Option 1 : Via le script d'initialisation (recommandé)

```bash
# En tant que root MySQL
mysql -u root -p < db/init-mysql.sql
```

Option 2 : Manuellement

```sql
CREATE DATABASE logsystem CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'logsystem'@'localhost' IDENTIFIED BY 'StrongPasswordHere123!';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, EXECUTE ON logsystem.* TO 'logsystem'@'localhost';
FLUSH PRIVILEGES;
```

### 5. Exécuter les migrations

```bash
npm start
```

Les migrations s'exécutent automatiquement au démarrage (si `RUN_MIGRATIONS_ON_START=true`).

### 6. Créer l'utilisateur admin

```bash
npm run create-admin
```

Par défaut :
- Email : `admin@logsystem.local`
- Mot de passe : `CHANGE_THIS_STRONG_PASSWORD_IMMEDIATELY`

**IMPORTANT : Changez ce mot de passe immédiatement après la première connexion.**

### 7. Démarrer le serveur

```bash
npm start
```

Ou en mode développement avec rechargement automatique :

```bash
npm run dev
```

L'application sera accessible sur `http://localhost:3001` (ou le port configuré dans `PORT`).

## Variables d'environnement

### Base de données MySQL

| Variable | Description | Défaut | Exemple |
|----------|-------------|--------|---------|
| `DB_HOST` | Hôte MySQL | `localhost` | `mysql-xxx.aivencloud.com` |
| `DB_PORT` | Port MySQL | `3306` | `21661` |
| `DB_USER` | Utilisateur MySQL | `root` | `avnadmin` |
| `DB_PASSWORD` | Mot de passe MySQL | `` | `StrongPassword123!` |
| `DB_NAME` | Nom de la base | `logsystem` | `logsystem` |
| `DB_SSL` | Activer SSL | `false` | `true` |
| `DB_SSL_CA_PATH` | Chemin certificat CA | - | `/path/to/ca.pem` |
| `DB_SSL_REJECT_UNAUTHORIZED` | Vérifier certificat | `true` | `true` |
| `DB_KEEPALIVE` | Keepalive connexion | `true` | `true` |
| `DB_CONNECTION_LIMIT` | Limite pool connexions | `10` | `5` |

### Sécurité

| Variable | Description | Requis |
|----------|-------------|--------|
| `SESSION_SECRET` | Secret sessions | Oui (32+ caractères) |
| `CSRF_SECRET` | Secret CSRF | Oui (32+ caractères) |
| `BCRYPT_ROUNDS` | Rounds bcrypt | `12` |

### Application

| Variable | Description | Défaut |
|----------|-------------|--------|
| `PORT` | Port serveur | `3001` |
| `NODE_ENV` | Environnement | `development` |
| `LOG_LEVEL` | Niveau logs | `info` |

### Profils de configuration

#### Développement local

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=logsystem
DB_SSL=false
```

#### Production (Aiven/MySQL distant)

```env
DB_HOST=mysql-xxx.aivencloud.com
DB_PORT=21661
DB_USER=avnadmin
DB_PASSWORD=StrongPassword123!
DB_NAME=logsystem
DB_SSL=true
DB_SSL_CA_PATH=/path/to/ca.pem
DB_SSL_REJECT_UNAUTHORIZED=true
```

## Sauvegarde et restauration

### Sauvegarde

```bash
mysqldump -u logsystem -p logsystem > backup_$(date +%Y%m%d_%H%M%S).sql
```

### Restauration

```bash
mysql -u logsystem -p logsystem < backup_20261014_120000.sql
```

## Docker

### Démarrage avec Docker Compose

```bash
docker compose up -d
```

Accès :
- Application : http://localhost:10000
- MySQL : localhost:3306 (interne au réseau Docker)
- Redis : localhost:6379 (interne au réseau Docker)

### Arrêter

```bash
docker compose down
```

### Nettoyer (données incluses)

```bash
docker compose down -v
```

## Déploiement

Pour le déploiement en production, consultez le guide complet : [DEPLOYMENT.md](DEPLOYMENT.md)

### Options de déploiement

1. **Docker Compose (self-hosted)** - Voir `DEPLOYMENT.md`
2. **Render** - Utilisez `render.yaml` avec une base de données managée
3. **Autre provider** - Adaptez la configuration selon votre infrastructure

### Configuration rapide Docker Compose

```bash
# Copier le template de production
cp .env.production.example .env.production

# Générer des secrets sécurisés
openssl rand -base64 32  # Répétez pour chaque secret

# Éditer .env.production avec vos secrets
nano .env.production

# Déployer
docker compose --env-file .env.production up -d
```

### Checklist de mise en production

- [ ] Changer tous les mots de passe par défaut dans `.env.production`
- [ ] Configurer `SESSION_SECRET` et `CSRF_SECRET` avec des valeurs fortes
- [ ] Activer SSL/TLS pour MySQL (`DB_SSL=true`) si base managée
- [ ] Configurer HTTPS avec reverse proxy (Nginx/Apache)
- [ ] Configurer les backups automatiques
- [ ] Surveiller les logs et les métriques
- [ ] Configurer les limites de ressources
- [ ] Vérifier les healthchecks (`/health`)
- [ ] Configurer le firewall pour limiter l'accès

### Render

Le fichier `render.yaml` contient la configuration pour Render. Les variables de base de données doivent être configurées dans le dashboard Render.

## Tests

```bash
# Linter
npm run lint

# Tests unitaires
npm test

# Tests fonctionnels
node scripts/tests/test-functional-global.js
```

## Architecture

- **Backend** : Node.js + Express
- **Base de données** : MySQL 8
- **Cache** : Redis (optionnel)
- **Authentification** : Sessions + bcrypt
- **Sécurité** : Helmet, CSRF, rate limiting

## Support

Pour les problèmes et questions :
- Vérifier les logs dans le dossier `logs/`
- Consulter la documentation dans `docs/`
- Vérifier le healthcheck : `curl http://localhost:3001/health`

## Licence

Propriétaire
