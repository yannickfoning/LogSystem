# Configuration MariaDB pour LogSystem

Ce guide explique comment configurer MariaDB pour LogSystem. MariaDB est un fork de MySQL et est 100% compatible avec notre application.

## Pourquoi MariaDB ?

- **Open source** et communautaire
- **Performances supérieures** à MySQL
- **100% compatible** avec le protocole MySQL
- **Fonctionnalités avancées** (moteurs de stockage, optimisations)
- **Sécurité renforcée**
- **Maintenance active** par la communauté

## Installation sur Windows

### 1. Télécharger MariaDB

Allez sur https://mariadb.org/download/ et téléchargez l'installeur pour Windows.

### 2. Installer MariaDB

1. Exécutez l'installeur
2. Choisissez "Typical" ou "Custom" selon vos besoins
3. Configurez le mot de passe root (notez-le !)
4. Cochez "Enable TCP/IP networking" (port 3306 par défaut)
5. Cochez "Start service after installation"
6. Terminez l'installation

### 3. Vérifier l'installation

Ouvrez un terminal et exécutez :

```bash
mysql --version
```

Vous devriez voir quelque chose comme :
```
mysql  Ver 15.1 Distrib 10.11.x-MariaDB
```

### 4. Connecter à MariaDB

```bash
mysql -u root -p
```

Entrez le mot de passe root que vous avez défini lors de l'installation.

## Configuration de la base de données

### 1. Créer la base de données

Une fois connecté à MariaDB :

```sql
CREATE DATABASE logsystem CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 2. Créer un utilisateur dédié (recommandé)

```sql
CREATE USER 'logsystem'@'localhost' IDENTIFIED BY 'votre_mot_de_passe_strong';
GRANT ALL PRIVILEGES ON logsystem.* TO 'logsystem'@'localhost';
FLUSH PRIVILEGES;
```

### 3. Configurer le fichier .env

Dans le dossier du projet, créez ou éditez le fichier `.env` :

```env
# Database Configuration (MariaDB/MySQL)
DB_HOST=localhost
DB_PORT=3306
DB_USER=logsystem
DB_PASSWORD=votre_mot_de_passe_strong
DB_NAME=logsystem
DB_SSL=false
```

**Note** : Si vous préférez utiliser l'utilisateur root :

```env
DB_USER=root
DB_PASSWORD=votre_mot_de_passe_root
```

## Migration depuis MySQL vers MariaDB

Si vous avez déjà des données dans MySQL :

### 1. Exporter depuis MySQL

```bash
mysqldump -u root -p logsystem > logsystem_backup.sql
```

### 2. Importer dans MariaDB

```bash
mysql -u root -p logsystem < logsystem_backup.sql
```

### 3. Mettre à jour .env

Le fichier `.env` ne nécessite aucun changement car MariaDB utilise le même protocole que MySQL.

## Outils de gestion MariaDB

### HeidiSQL (Windows)

1. Téléchargez depuis https://www.heidisql.com/
2. Connectez-vous avec vos credentials MariaDB
3. Gérez vos bases de données visuellement

### DBeaver (Multi-plateforme)

1. Téléchargez depuis https://dbeaver.io/
2. Créez une nouvelle connexion MariaDB
3. Utilisez les mêmes credentials que dans `.env`

### phpMyAdmin (via XAMPP)

Si vous utilisez XAMPP avec MariaDB :

1. Démarrez Apache et MariaDB via XAMPP Control Panel
2. Allez sur http://localhost/phpmyadmin
3. Gérez votre base de données via l'interface web

## Optimisations MariaDB

### 1. Activer InnoDB (par défaut)

MariaDB utilise InnoDB par défaut, ce qui est optimal pour LogSystem.

### 2. Configurer le cache

Editez `my.ini` (Windows) ou `my.cnf` (Linux) :

```ini
[mysqld]
# Cache des tables
table_open_cache=400

# Cache InnoDB
innodb_buffer_pool_size=256M

# Log buffer
innodb_log_buffer_size=8M
```

### 3. Activer le query cache (optionnel)

```ini
[mysqld]
query_cache_type=1
query_cache_size=32M
```

## Dépannage

### Erreur : "Can't connect to MySQL server"

1. Vérifiez que le service MariaDB est démarré :
   ```bash
   # Windows
   sc query MariaDB
   # Ou via Services.msc
   ```

2. Vérifiez le port (3306 par défaut) :
   ```bash
   netstat -an | findstr 3306
   ```

### Erreur : "Access denied for user"

1. Vérifiez les credentials dans `.env`
2. Réinitialisez le mot de passe si nécessaire :
   ```sql
   ALTER USER 'root'@'localhost' IDENTIFIED BY 'nouveau_mot_de_passe';
   FLUSH PRIVILEGES;
   ```

### Erreur : "Unknown database 'logsystem'"

1. Connectez-vous à MariaDB
2. Créez la base de données :
   ```sql
   CREATE DATABASE logsystem CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```

## Sécurité

### 1. Supprimer les utilisateurs anonymes

```sql
DELETE FROM mysql.user WHERE User='';
FLUSH PRIVILEGES;
```

### 2. Supprimer la base de données test

```sql
DROP DATABASE IF EXISTS test;
FLUSH PRIVILEGES;
```

### 3. Restreindre l'accès root

```sql
CREATE USER 'admin'@'localhost' IDENTIFIED BY 'mot_de_passe_strong';
GRANT ALL PRIVILEGES ON *.* TO 'admin'@'localhost' WITH GRANT OPTION;
FLUSH PRIVILEGES;
```

## Backup et Restauration

### Backup automatique

Créez un script `backup-mariadb.bat` :

```batch
@echo off
set BACKUP_DIR=D:\backups\mariadb
set DATE=%date:~0,4%%date:~5,2%%date:~8,2%
set BACKUP_FILE=%BACKUP_DIR%\logsystem_%DATE%.sql

if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

mysqldump -u logsystem -p logsystem > "%BACKUP_FILE%"
echo Backup completed: %BACKUP_FILE%
```

### Restauration

```bash
mysql -u logsystem -p logsystem < backup_file.sql
```

## Ressources

- Documentation MariaDB : https://mariadb.com/kb/en/documentation/
- Migration MySQL vers MariaDB : https://mariadb.com/kb/en/mariadb-vs-mysql-compatibility/
- Performance Tuning : https://mariadb.com/kb/en/optimization-and-tuning/
