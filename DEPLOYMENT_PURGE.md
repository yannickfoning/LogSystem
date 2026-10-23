# Guide de Purge Complète - LogSystem (Déploiement Render/Aiven)

Ce guide explique comment purger complètement la plateforme déployée : base de données, fichiers, et données d'usage.

## Prérequis

- Accès au dashboard Render : https://dashboard.render.com
- Accès au dashboard Aiven : https://aiven.io
- Accès MySQL client local (mysql client installé)
- Accès au repo GitHub local

---

## ÉTAPE 1 : Purger la Base de Données MySQL (Aiven)

### Option A - Via interface Aiven (Recommandée)

1. **Connectez-vous sur** https://aiven.io
2. **Allez dans** votre service MySQL
3. **Cliquez sur** "Service settings" → "Reset" ou "Truncate"
4. **Confirmez** la purge
5. **Attendez** que le service redémarre (1-2 minutes)

### Option B - Via MySQL Client (Plus précis)

```bash
# Remplacez les variables par vos credentials Aiven
DB_HOST="mysql-aab9c07-yannickfoning22-33d3.d.aivencloud.com"
DB_PORT="21661"
DB_USER="avnadmin"
DB_PASSWORD="votre_mot_de_passe"
DB_NAME="defaultdb"

# Connexion et purge
mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" -e "
DROP DATABASE IF EXISTS \`$DB_NAME\`;
CREATE DATABASE \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
"
```

**Validation :**
```bash
# Vérifier que la base est vide
mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -e "SHOW TABLES;"
# Devrait retourner : Empty set
```

---

## ÉTAPE 2 : Redémarrer le Service Render

### Option A - Via Dashboard Render

1. **Allez sur** https://dashboard.render.com
2. **Cliquez sur** votre service `logsystem`
3. **Cliquez sur** "Manual Deploy" (en haut à droite)
4. **Sélectionnez** la branche `main`
5. **Cliquez sur** "Deploy"
6. **Attendez** le déploiement (2-3 minutes)

### Option B - Via Redémarrage Simple

1. **Allez sur** https://dashboard.render.com
2. **Cliquez sur** votre service `logsystem`
3. **Cliquez sur** "Restart Service"
4. **Attendez** le redémarrage (1-2 minutes)

**Validation :**
Vérifiez les logs Render, vous devriez voir :
```
✅ db_connected
✅ 47 migrations completed
✅ schema_skipped_existing_db (base vide recréée par migrations)
✅ Service live
```

---

## ÉTAPE 3 : Nettoyer les Fichiers Uploads (Optionnel)

Les fichiers uploads sont stockés dans `/opt/render/project/src/uploads/` sur Render.

### Option A - Via Shell Render (Si disponible)

1. **Allez sur** https://dashboard.render.com
2. **Cliquez sur** votre service `logsystem`
3. **Cliquez** sur "Shell" (en bas)
4. **Exécutez** :
```bash
rm -rf /opt/render/project/src/uploads/*
rm -rf /opt/render/project/src/temp/*
```

### Option B - Via Redéploiement (Plus simple)

Si vous n'avez pas accès au shell, le plus simple est de créer un nouveau service Render. Le système de fichiers est volatil et sera automatiquement nettoyé.

---

## ÉTAPE 4 : Valider la Santé du Service

### Test de santé Render

```bash
curl -f https://logsystem-z41e.onrender.com/health
```

**Réponse attendue :**
```json
{
  "status": "ok",
  "database": "ok",
  "timestamp": "...",
  "uptime": ...
}
```

### Test de santé Local (Si applicable)

```bash
curl -f http://localhost:10000/health
```

---

## ÉTAPE 5 : Recréer l'Utilisateur Admin

Le pool de connexion doit être vide, donc il n'y a aucun utilisateur.

### Configuration Locale

```bash
# Dans votre .env local
DB_HOST=mysql-aab9c07-yannickfoning22-33d3.d.aivencloud.com
DB_PORT=21661
DB_USER=avnadmin
DB_PASSWORD=votre_mot_de_passe
DB_NAME=defaultdb
DB_SSL=true
DB_SSL_CA_PATH=/chemin/vers/ca.pem
```

### Création de l'Admin

```bash
cd /d/COLEPS/code/LogSystem
npm run create-admin
```

**Identifiants par défaut :**
- Email : `admin@logsystem.local`
- Mot de passe : `Admin@1234`

⚠️ **Changez ce mot de passe immédiatement après la première connexion !**

---

## ÉTAPE 6 : Validation Fonctionnelle

### 6.1 - Test d'accès

1. **Allez sur** https://logsystem-z41e.onrender.com
2. **Connectez-vous** avec l'admin créé
3. **Changez le mot de passe** immédiatement

### 6.2 - Test Import de Logs

1. **Allez sur** Import (📥 Importer)
2. **Importez** un fichier log de test
3. **Vérifiez** que l'import se termine avec succès
4. **Vérifiez** que les logs apparaissent dans le dashboard

### 6.3 - Test Dashboard

1. **Allez sur** Dashboard (📊 Vue d'ensemble)
2. **Vérifiez** que les KPIs s'affichent
3. **Vérifiez** que le graphique de tendances s'affiche
4. **Vérifiez** que les logs récents s'affichent

### 6.4 - Test Recherche

1. **Allez sur** Search (🔍 Rechercher)
2. **Faites** une recherche simple
3. **Vérifiez** que les résultats s'affichent

### 6.5 - Test Alertes

1. **Allez sur** Administration → Règles d'alerte
2. **Créez** une règle d'alerte de test
3. **Vérifiez** qu'elle apparaît dans le dashboard

---

## ÉTAPE 7 : Validation BDD (Optionnel)

```bash
cd /d/COLEPS/code/LogSystem
npm install
npm test
npm run lint
```

---

## Checklist de Validation Complète

- [ ] Base de données purgée (DROP DATABASE + CREATE DATABASE)
- [ ] Service Render redémarré
- [ ] `/health` répond OK
- [ ] Application accessible sur https://logsystem-z41e.onrender.com
- [ ] Login fonctionne
- [ ] Admin créé (npm run create-admin)
- [ ] Mot de passe admin changé
- [ ] Import de logs fonctionne
- [ ] Dashboard affiche les KPIs
- [ ] Graphique de tendances s'affiche
- [ ] Recherche fonctionne
- [ ] Alertes fonctionnent
- [ ] Aucune erreur dans les logs Render

---

## Problèmes Courants et Solutions

### Problème : ECONNREFUSED sur Render

**Cause :** Service Aiven arrêté ou firewall bloque les connexions

**Solution :**
1. Vérifiez que le service Aiven est "Running"
2. Vérifiez le firewall Aiven (Permitted IP addresses : 0.0.0.0/0)
3. Redémarrez le service Render

### Problème : Migrations échouent

**Cause :** Base de données non purgée correctement

**Solution :**
1. Vérifiez que la base est vide (SHOW TABLES vide)
2. Redémarrez le service (RUN_MIGRATIONS_ON_START=true)
3. Vérifiez les logs Render pour les erreurs SQL

### Problème : Import échoue

**Cause :** Variables d'environnement upload non configurées

**Solution :**
1. Vérifiez UPLOAD_TEMP_DIR, UPLOAD_DEPOT_DIR, UPLOAD_TRAITED_DIR dans Render
2. Vérifiez que les répertoires sont créés (logs "directory_created")
3. Réduisez UPLOAD_MAX_SIZE si problème de mémoire

---

## Méthode "Tout Réinitialiser Proprement"

La méthode la plus propre pour une réinitialisation complète :

1. **Purger la base MySQL** (DROP DATABASE + CREATE DATABASE)
2. **Redéployer le service Render** (Manual Deploy)
3. **Vérifier `/health`**
4. **Créer l'admin** (npm run create-admin)
5. **Tester l'import**
6. **Tester les fonctionnalités**

Cela garantit une plateforme propre avec :
- Base de données vide
- Schéma recréé par migrations
- Aucun fichier upload
- Aucun utilisateur
- Configuration propre

---

## Support

En cas de problème :
1. Vérifiez les logs Render : https://dashboard.render.com → service → Logs
2. Vérifiez les logs Aiven : https://aiven.io → service → Logs
3. Consultez la documentation dans `DEPLOYMENT.md` et `AGENTS.md`
