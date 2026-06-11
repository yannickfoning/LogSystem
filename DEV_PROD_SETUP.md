# Guide de Configuration DEV / PROD

Ce document explique comment configurer les environnements de développement local et de production pour LogSystem, en assurant une séparation claire et sécurisée des bases de données et des services.

## Objectifs

- **Développement Local** : Utiliser une base de données MySQL locale (`localhost:3306`, base `log`), sans SSL.
- **Production** : Utiliser la base de données Aiven MySQL existante, avec SSL activé, telle que configurée sur Render.

## 1. Variables d'Environnement

LogSystem utilise les variables d'environnement pour toutes ses configurations sensibles.

### Fichier `.env.example`

Un fichier `.env.example` est fourni à la racine du projet. Il contient les variables minimales requises pour un environnement de développement local.

```dotenv
NODE_ENV=development
PORT=3001

DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=log
DB_SSL=false

SESSION_SECRET=CHANGE_ME_WITH_A_LONG_SECRET

# ... (autres variables optionnelles comme UPLOAD_MAX_SIZE, WATCH_DIRS, etc.)
```

### Configuration Locale (`.env`)

1. **Copiez** le fichier `.env.example` et renommez-le en `.env` à la racine de votre projet.
2. **Modifiez** les valeurs :
    - `DB_PASSWORD` : Le mot de passe de votre utilisateur `root` MySQL local.
    - `SESSION_SECRET` : **Générez une clé secrète longue et aléatoire** (minimum 32 caractères, idéalement 64). Vous pouvez utiliser `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` pour en générer une.
    - Assurez-vous que `DB_SSL=false`.

### Configuration de Production (Render)

Les variables d'environnement pour la production doivent être configurées directement sur la plateforme de déploiement (Render dans ce cas).

**Ne modifiez JAMAIS ces variables directement dans le code ou dans un `.env` qui serait versionné et déployé.**

Les variables Aiven existantes (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, DB_SSL=true, DB_SSL_CA_PATH ou DB_SSL_CA) doivent être configurées dans les "Environment Variables" de votre service Render.

## 2. Démarrage de l'Application

### Démarrage Local

1.  Assurez-vous que votre serveur MySQL local est en cours d'exécution et que la base de données `log` existe (ou créez-la).
2.  Exécutez `npm install` pour installer les dépendances.
3.  Démarrez l'application : `npm run dev` ou `node server.js`.
4.  Au démarrage, vous verrez un log similaire à : `[DB] MySQL connection successful { event: 'db_connected', env: 'development', database: 'root@localhost/log' }`.

### Déploiement en Production

Le déploiement sur Render utilisera automatiquement les variables d'environnement configurées sur la plateforme. Le log de démarrage affichera : `[DB] MySQL connection successful { event: 'db_connected', env: 'production', database: 'avnadmin@mysql-xxx.aivencloud.com/defaultdb' }`.

## 3. Migrations de Base de Données

Les scripts de migration SQL (`db/migrations/*.sql`) sont conçus pour être agnostiques à l'environnement. Le `migrationRunner.js` (exécuté au démarrage de `server.js`) utilisera la connexion à la base de données configurée via les variables d'environnement.

- **Local** : Les migrations s'appliqueront à votre base `localhost/log`.
- **Production** : Les migrations s'appliqueront à votre base Aiven.

## 4. Risques et Vérifications

### Risques

- **Oubli de `.env` local** : Si le fichier `.env` n'est pas créé ou est mal configuré, l'application pourrait tenter de se connecter à des valeurs par défaut ou échouer.
- **`SESSION_SECRET` non valide** : Un `SESSION_SECRET` trop court ou contenant "change-me" empêchera l'application de démarrer (vérification en place dans `server.js`).
- **Conflit de port** : Si `PORT=3001` est déjà utilisé localement, l'application ne démarrera pas.

### Vérifications Essentielles

- **Log de démarrage** : Toujours vérifier le log `[DB] MySQL connection successful` pour confirmer l'environnement et la base de données ciblée.
- **Fonctionnalités clés** : Tester la connexion utilisateur, la recherche de logs, l'importation et les dashboards dans l'environnement local.
- **Migrations** : S'assurer que les migrations s'exécutent sans erreur dans les deux environnements.
- **Sessions** : Vérifier que la connexion et la déconnexion fonctionnent correctement, et que la session est persistante.

---

Cette configuration assure une séparation propre et efficace entre vos environnements de développement et de production, vous permettant de travailler localement sans affecter la production et de déployer en toute confiance.