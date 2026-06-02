# 🚀 **GUIDE D'INSTALLATION - LogSystem V4**

## **PRÉREQUIS**

1. **Node.js** v18+ (recommandé v20)
2. **MySQL** v8.0+ 
3. **Git** (pour le versioning)

---

## **ÉTAPE 1 - INSTALLATION**

```bash
# Cloner le projet
git clone <repository-url>
cd LogSystem-V4

# Installer les dépendances
npm install
```

---

## **ÉTAPE 2 - CONFIGURATION BASE DE DONNÉES**

### **Option A : MySQL Local**
```sql
# Se connecter à MySQL
mysql -u root -p

# Créer la base de données
CREATE DATABASE logsystem_v4 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

# Créer l'utilisateur (optionnel)
CREATE USER 'logsystem'@'localhost' IDENTIFIED BY 'votre_mot_de_passe';
GRANT ALL PRIVILEGES ON logsystem_v4.* TO 'logsystem'@'localhost';
FLUSH PRIVILEGES;
```

### **Option B : Docker MySQL**
```bash
# Démarrer MySQL avec Docker
docker run --name mysql-logsystem -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=logsystem_v4 -p 3306:3306 -d mysql:8.0
```

---

## **ÉTAPE 3 - IMPORTER LE SCHÉMA**

```bash
# Recommandé : appliquer le schéma via Node (lit db/schema.sql)
npm run schema

# Ou en ligne de commande MySQL
mysql -u root -p logsystem_v4 < db/schema.sql

# Index optionnels (optimisation)
mysql -u root -p logsystem_v4 < db/indexes.sql

# Migrations incrémentales (si base déjà créée sans user_id, etc.)
mysql -u root -p logsystem_v4 < db/migrations/migration_userscope.sql
mysql -u root -p logsystem_v4 < db/migrations/migration_errorgroups_fix.sql
```

---

## **ÉTAPE 4 - CONFIGURATION ENVIRONNEMENT**

```bash
# Copier le template .env
cp .env.example .env

# Générer un secret sécurisé
npm run secret

# Éditer .env avec vos configurations
```

**Variables importantes :**
```env
PORT=3001
SESSION_SECRET=<votre_secret_64_caracteres>
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=votre_mot_de_passe_mysql
DB_NAME=logsystem_v4
```

---

## **ÉTAPE 5 - DÉMARRAGE**

```bash
# Démarrer le serveur
npm start

# Ou en mode développement
npm run dev
```

Le serveur sera accessible sur : **http://localhost:3001**

---

## **ÉTAPE 6 - VÉRIFICATION**

1. **Accéder à l'interface** : http://localhost:3001/login.html
2. **Créer un compte admin** (premier utilisateur = admin)
3. **Tester l'import de logs**
4. **Vérifier les alertes temps réel**

---

## **COMPTES PAR DÉFAUT**

Le premier utilisateur créé automatiquement devient administrateur.

---

## **TROUBLESHOOTING**

### **ERREUR : Database connection failed**
```bash
# Vérifier que MySQL est démarré
sudo systemctl status mysql  # Linux
brew services list | grep mysql  # macOS

# Vérifier les identifiants dans .env
```

### **ERREUR : SESSION_SECRET invalide**
```bash
# Régénérer un secret valide
npm run secret
```

### **ERREUR : Port déjà utilisé**
```bash
# Modifier le PORT dans .env
PORT=3002
```

---

## **PRODUCTION**

### **Avec PM2**
```bash
npm install -g pm2
pm2 start server.js --name logsystem-v4
pm2 startup
pm2 save
```

### **Avec Docker**
```bash
docker build -t logsystem-v4 .
docker run -p 3001:3001 --env-file .env logsystem-v4
```

---

## **MONITORING**

- **Logs application** : Console et fichier logs/
- **Performance** : Dashboard admin
- **Base de données** : MySQL slow query log
- **Santé serveur** : Endpoint /health

---

*Pour toute question : consulter `docs/ANALYSE_COMPLETE_RAPPORT.md`*
