# LogSystem V4 - Guide de Déploiement Render + TiDB

## 📋 Table des matières
1. [Préparation](#préparation)
2. [Configuration TiDB Cloud](#configuration-tidb-cloud)
3. [Configuration Render](#configuration-render)
4. [Variables d'environnement](#variables-denvironnement)
5. [Post-déploiement](#post-déploiement)
6. [Troubleshooting](#troubleshooting)

---

## Préparation

### ✅ Prérequis
- Compte GitHub (repo `yannickfoning/LogSystem`)
- Compte gratuit [TiDB Cloud](https://tidbcloud.com)
- Compte gratuit [Render](https://render.com)

### ✅ Vérifier le repository
```bash
# Votre repo doit contenir:
✓ package.json (avec scripts: "start": "node server.js")
✓ server.js (point d'entrée)
✓ db/schema.sql (schéma initial)
✓ db/migrations/001_add_log_intelligence.sql (migration auto)
✓ lib/database/migrationRunner.js (runner migrations)
✓ .env.example (template variables)
```

---

## Configuration TiDB Cloud

### Étape 1 : Créer un Developer Cluster

1. Aller sur [tidbcloud.com](https://tidbcloud.com)
2. **Sign Up** (gratuit)
3. Créer un **Developer Tier Cluster**
   - Région : Europe (pour latence basse)
   - Nom : `LogSystem-V4`

### Étape 2 : Obtenir les credentials

1. **Database Access** → Créer un user
   ```
   Username: logsystem
   Password: [Générer un mot de passe fort 32+ chars]
   ```

2. Copier la **Connection String** (MySQL)
   ```
   mysql://logsystem:PASSWORD@xxxxx.tidbcloud.com:4000/
   ```

3. Copier le **CA Certificate** (pour SSL)

### Étape 3 : Créer la base de données

```sql
CREATE DATABASE logsystem DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE logsystem;
-- Importer db/schema.sql via MySQL client
```

**Commande locale pour tester :**
```bash
mysql -h xxxxx.tidbcloud.com -P 4000 -u logsystem -p logsystem < db/schema.sql
```

---

## Configuration Render

### Étape 1 : Créer un Web Service

1. Aller sur [render.com](https://render.com)
2. **Dashboard** → **New** → **Web Service**
3. Sélectionner votre repo GitHub `yannickfoning/LogSystem`
4. Remplir :
   ```
   Name: logsystem-api
   Runtime: Node
   Build Command: npm install
   Start Command: npm start
   ```

### Étape 2 : Variables d'environnement

Ajouter dans **Environment** (Settings → Environment) :

```env
# Database (TiDB Cloud)
DB_HOST=xxxxx.tidbcloud.com
DB_PORT=4000
DB_USER=logsystem
DB_PASSWORD=YOUR_PASSWORD_HERE
DB_NAME=logsystem
DB_SSL=true

# Server
NODE_ENV=production
PORT=3000

# Security (générer avec: openssl rand -base64 32)
SESSION_SECRET=YOUR_GENERATED_SECRET_HERE

# Logs & Watcher
WATCH_DIRS=/tmp/logs
WATCH_DIR_USER_MAP=/tmp/logs:1

# Configuration
ERROR_RETURN_GAP_DAYS=7
IMPORT_BATCH_SIZE=2000
UPLOAD_MAX_SIZE=52428800
ALERT_EVAL_INTERVAL=60000
ALERT_DEBOUNCE_MS=2000

# Optional: Cache Redis (laissez vide si non disponible)
REDIS_URL=
```

### Étape 3 : Déployer

1. Cliquer sur **Create Web Service**
2. Render démarre la build (~2-5 minutes)
3. Attendre le message `"Your service is live"`

**URL du service :**
```
https://logsystem-api-xxxxx.onrender.com
```

---

## Variables d'environnement

### 🔐 Session Secret (IMPORTANT)

Générer localement :
```bash
openssl rand -base64 32
```

**Copier-coller dans Render.**

### 🗄️ Database

| Variable | Valeur | Exemple |
|----------|--------|---------|
| `DB_HOST` | Host TiDB | `xxxxx.tidbcloud.com` |
| `DB_PORT` | Port TiDB | `4000` |
| `DB_USER` | User créé | `logsystem` |
| `DB_PASSWORD` | Password user | `abc123...` |
| `DB_NAME` | Database name | `logsystem` |
| `DB_SSL` | Use SSL | `true` |

### 📝 Logs & Monitoring

| Variable | Valeur | Défaut |
|----------|--------|--------|
| `WATCH_DIRS` | Chemins à surveiller | `./logs` |
| `WATCH_DIR_USER_MAP` | Mapping dir→user | `./logs:1` |
| `ERROR_RETURN_GAP_DAYS` | Jours avant retour détecté | `7` |
| `IMPORT_BATCH_SIZE` | Taille batch import | `2000` |

### ⚠️ Alertes

| Variable | Valeur | Défaut |
|----------|--------|--------|
| `ALERT_EVAL_INTERVAL` | Évaluation (ms) | `60000` |
| `ALERT_DEBOUNCE_MS` | Debounce (ms) | `2000` |

---

## Post-déploiement

### 1️⃣ Vérifier la santé du service

```bash
curl https://logsystem-api-xxxxx.onrender.com/
# → Doit rediriger vers /login.html
```

### 2️⃣ Créer le premier admin

**Via MySQL :**
```sql
INSERT INTO users (email, password_hash, display_name, role, is_active)
VALUES ('admin@logsystem.local', '$2b$10$HASH_BCRYPT', 'Admin', 'admin', 1);
```

**Ou via UI :**
1. Aller sur `https://logsystem-api-xxxxx.onrender.com/`
2. Créer un compte
3. Mettre le rôle à `admin` via MySQL

### 3️⃣ Tester les migrations

**Logs du déploiement (Render > Logs) :**
```
[MIGRATION] starting_migrations
[MIGRATION] running_migration name=001_add_log_intelligence.sql
[MIGRATION] migration_completed name=001_add_log_intelligence.sql
```

### 4️⃣ Uploader des logs de test

1. Aller sur `https://logsystem-api-xxxxx.onrender.com/import.html`
2. Uploader un fichier `.log` de test
3. Vérifier le traitement dans `https://logsystem-api-xxxxx.onrender.com/dashboard.html`

---

## Troubleshooting

### ❌ Erreur: "Cannot connect to database"

**Cause :** Variables d'env mal configurées

**Solution :**
```bash
# 1. Vérifier DB_HOST, DB_PORT, DB_USER, DB_PASSWORD dans Render
# 2. Tester localement:
mysql -h xxxxx.tidbcloud.com -P 4000 -u logsystem -p

# 3. Redéployer après correction des vars
```

### ❌ Erreur: "Migrations failed"

**Cause :** Fichiers de migration manquants

**Solution :**
```bash
# Vérifier que le fichier existe:
git ls-files | grep "db/migrations"

# Doit retourner:
# db/migrations/001_add_log_intelligence.sql
```

### ❌ Erreur: "SESSION_SECRET not found"

**Cause :** Variable d'env non définie

**Solution :**
```bash
# Générer et ajouter dans Render:
openssl rand -base64 32
# Copier dans Environment > SESSION_SECRET
```

### ⚠️ Service redémarre en boucle

**Cause :** Erreur au démarrage (logs, DB, etc.)

**Solution :**
```bash
# Vérifier les logs (Render > Logs):
tail -100 /var/log/application.log

# Erreur courante: DB_SSL=true mais cert manquant
# → Définir DB_SSL=false ou ajouter le cert
```

### 🐌 Performances lentes

**Optimisations :**
```env
# Augmenter les timeouts
DB_POOL_MAX=10
DB_POOL_QUEUE_TIMEOUT=5000

# Réduire la fréquence d'alertes
ALERT_EVAL_INTERVAL=120000
SAFETY_INTERVAL=120000
```

---

## Monitoring

### Render Logs

```bash
# Voir les logs en temps réel:
# Render Dashboard > Service > Logs

# Chercher les erreurs:
grep -i "error\|fatal\|warn" logs.txt
```

### Vérifier la santé

```bash
# Health check simple:
curl -I https://logsystem-api-xxxxx.onrender.com/

# HTTP 301 Redirect to login = ✅ OK
```

### TiDB Monitoring

```sql
-- Via TiDB Cloud Console:
SELECT COUNT(*) as total_logs FROM logs;
SELECT COUNT(*) as error_count FROM error_groups WHERE status = 'open';
```

---

## Mise à jour du code

### Déployer une nouvelle version

```bash
# 1. Push votre code sur GitHub
git push origin main

# 2. Render redéploie automatiquement
# (ou manuel: Dashboard > Redeploy)

# 3. Les migrations s'appliquent auto au redémarrage
```

### Ajouter une nouvelle migration

```bash
# 1. Créer: db/migrations/002_add_new_feature.sql
# 2. Push sur GitHub
# 3. Render redéploie → migration appliquée automatiquement
```

---

## Ressources

- [TiDB Cloud Docs](https://docs.tidbcloud.com)
- [Render Deploy Guide](https://render.com/docs)
- [LogSystem Repo](https://github.com/yannickfoning/LogSystem)

---

## 📞 Support

Pour les erreurs spécifiques :
1. Vérifier les logs Render
2. Vérifier les logs TiDB
3. Tester localement avec les mêmes variables d'env

**Vous êtes maintenant prêt ! 🚀**
