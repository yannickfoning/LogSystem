# Configuration Apache pour LogSystem (Windows)

Ce guide explique comment configurer Apache pour servir LogSystem sur Windows.

## Prérequis

1. **Apache HTTP Server** installé sur Windows
   - Téléchargez Apache depuis https://www.apachefriends.org/ (XAMPP) ou https://www.apachehaus.com/
   - Ou installez via : `choco install apache`

2. **Node.js** installé (version 22.x)
   - Téléchargez depuis https://nodejs.org/

3. **MySQL 8** installé et configuré
   - Téléchargez depuis https://dev.mysql.com/downloads/mysql/
   - MySQL 8.0+ requis pour le support complet du JSON et des collations UTF8MB4

## Installation

### 1. Copier la configuration Apache

Copiez le fichier `apache.conf` vers votre configuration Apache :

```bash
# Pour XAMPP
copy apache.conf C:\xampp\apache\conf\extra\httpd-vhosts.conf

# Pour Apache Haus
copy apache.conf C:\Apache24\conf\extra\httpd-vhosts.conf
```

### 2. Activer les modules Apache requis

Ouvrez le fichier `httpd.conf` et décommentez ces lignes :

```apache
LoadModule proxy_module modules/mod_proxy.so
LoadModule proxy_http_module modules/mod_proxy_http.so
LoadModule proxy_wstunnel_module modules/mod_proxy_wstunnel.so
LoadModule rewrite_module modules/mod_rewrite.so
LoadModule headers_module modules/mod_headers.so
LoadModule deflate_module modules/mod_deflate.so
LoadModule ssl_module modules/mod_ssl.so  # Pour HTTPS
```

### 3. Configurer les chemins

Dans `apache.conf`, modifiez les chemins selon votre installation :

```apache
DocumentRoot "D:/COLEPS/code/LogSystem/public"
<Directory "D:/COLEPS/code/LogSystem/public">
```

Remplacez `D:/COLEPS/code/LogSystem` par votre chemin réel.

### 4. Activer la configuration VirtualHost

Dans `httpd.conf`, décommentez :

```apache
Include conf/extra/httpd-vhosts.conf
```

### 5. Créer le dossier de logs

```bash
mkdir D:\COLEPS\code\LogSystem\logs
```

### 6. Démarrer le backend Node.js

Dans un terminal, depuis le dossier du projet :

```bash
# Installer les dépendances
npm install

# Configurer l'environnement
cp .env.example .env
# Éditez .env avec vos credentials MySQL

# Exécuter les migrations
npm run create-admin

# Démarrer le serveur
npm start
```

Le serveur Node.js démarrera sur le port 3000.

### 7. Démarrer Apache

```bash
# Via XAMPP Control Panel
# Cliquez sur "Start" pour Apache

# Ou via ligne de commande
httpd -k start
```

## Vérification

1. Ouvrez votre navigateur et allez sur : `http://localhost`
2. Vous devriez voir la page d'accueil de LogSystem
3. Cliquez sur "Se Connecter" pour accéder à la page de login

## Structure des fichiers

```
LogSystem/
├── public/              # Fichiers statiques servis par Apache
│   ├── index.html      # Page d'accueil
│   ├── login.html      # Page de connexion
│   ├── dashboard.html  # Dashboard
│   ├── styles.css      # Styles principaux
│   └── ...             # Autres assets
├── server.js           # Backend Node.js (port 3000)
├── routes/             # API routes
├── config/             # Configuration
└── logs/               # Logs Apache et application
```

## Routage

- **Fichiers statiques** (HTML, CSS, JS, images) → Served by Apache directement
- **API** (`/api/*`) → Proxied to Node.js (localhost:3000)
- **SSE** (`/sse/*`) → Proxied to Node.js pour les alertes en temps réel

## Dépannage

### Apache ne démarre pas

Vérifiez les logs d'erreur :
```
C:\xampp\apache\logs\error.log
```

### Erreur 403 Forbidden

Vérifiez les permissions dans la configuration :
```apache
Require all granted
```

### API ne fonctionne pas

Vérifiez que Node.js est en cours d'exécution :
```bash
curl http://localhost:3000/api/health
```

### Port déjà utilisé

Modifiez le port dans `server.js` ou dans Apache si nécessaire.

## HTTPS (Optionnel)

Pour activer HTTPS, vous avez besoin d'un certificat SSL :

1. Générez un certificat auto-signé ou obtenez-en un auprès d'une CA
2. Décommentez la section `<VirtualHost *:443>` dans `apache.conf`
3. Mettez à jour les chemins des certificats
4. Redémarrez Apache

## Performance

La configuration inclut :
- Compression (gzip)
- Cache statique (1 an pour les assets)
- Headers de sécurité
- Proxy vers Node.js pour l'API

## Sécurité

- Configurez un pare-feu pour limiter l'accès
- Utilisez HTTPS en production
- Mettez à jour régulièrement Apache et Node.js
- Configurez les CORS si nécessaire

## Support

Pour toute question ou problème, consultez :
- Documentation Apache : https://httpd.apache.org/docs/
- Documentation Express : https://expressjs.com/
