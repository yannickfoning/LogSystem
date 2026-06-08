# Migration Prisma → SQL Pur

## Vue d'ensemble

Ce document décrit la migration de Prisma ORM vers SQL pur (mysql2) pour préparer LogSystem au déploiement sur Render avec une base de données Aiven MySQL.

## Raisons de la migration

1. **Simplification**: Suppression d'une couche d'abstraction inutile
2. **Performance**: Requêtes SQL directes plus performantes
3. **Déploiement Render**: Meilleure compatibilité avec les services managés Aiven
4. **Maintenance**: Moins de dépendances et de complexité

## Changements effectués

### 1. Nouveaux fichiers créés

- `src/lib/sql-db.ts` - Module de connexion MySQL avec mysql2
- `src/lib/sql-helpers.ts` - Helpers mimant l'API Prisma pour compatibilité

### 2. Fichiers modifiés

- `src/lib/db.ts` - Remplacé PrismaClient par sql-helpers
- `.env.example` - Ajout des variables DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, DB_SSL
- `render.yaml` - Configuration pour Aiven MySQL
- `package.json` - Suppression des scripts et dépendances Prisma

### 3. Fichiers supprimés

- `prisma/` - Dossier complet (schema.prisma, migrations, etc.)
- `@prisma/client` - Package npm
- `prisma` - Package npm

## Configuration Aiven MySQL

### Variables d'environnement

```bash
DB_HOST=mysql-xxx.aivencloud.com
DB_PORT=21665
DB_USER=avnadmin
DB_PASSWORD=VOTRE_MOT_DE_PASSE_AIVEN
DB_NAME=defaultdb
DB_SSL=true
```

### Configuration Render

Le fichier `render.yaml` a été mis à jour pour utiliser les variables Aiven au lieu de DATABASE_URL.

## API SQL Helpers

Les helpers SQL miment l'API Prisma pour assurer une transition sans code breaking:

```typescript
// Avant (Prisma)
const users = await db.user.findMany({ where: { role: 'admin' } });

// Après (SQL pur)
const users = await db.user.findMany({ where: { role: 'admin' } });
```

### Opérations supportées

- `findMany()` - Requête avec filtres
- `findFirst()` - Premier résultat
- `findUnique()` - Recherche par ID
- `create()` - Création d'entité
- `createMany()` - Création en masse
- `update()` - Mise à jour
- `delete()` - Suppression
- `deleteMany()` - Suppression en masse
- `count()` - Comptage

### Entités supportées

- `user` - Utilisateurs
- `log` - Logs
- `alert` - Alertes
- `alertRule` - Règles d'alerte
- `auditLog` - Logs d'audit
- `anomaly` - Anomalies
- `importJob` - Jobs d'import
- `watchOffset` - Offsets de surveillance

## Migration du schema de base de données

Le schema Prisma a été converti en schema SQL natif. Les tables existantes sont conservées.

### Tables

- `users` - Utilisateurs
- `logs` - Logs
- `alerts` - Alertes
- `alert_rules` - Règles d'alerte
- `audit_log` - Logs d'audit
- `anomalies` - Anomalies
- `import_jobs` - Jobs d'import
- `watch_offsets` - Offsets de surveillance

## Déploiement sur Render

### Prérequis

1. Service Aiven MySQL créé
2. Variables d'environnement configurées dans Render
3. Base de données initialisée avec le schema SQL

### Étapes de déploiement

1. Connecter le repository Render
2. Configurer les variables d'environnement Aiven
3. Déployer automatiquement via render.yaml

### Variables Render

Les variables suivantes doivent être configurées dans Render:

- `DB_HOST` - Host Aiven MySQL
- `DB_PORT` - Port Aiven MySQL
- `DB_USER` - User Aiven
- `DB_PASSWORD` - Password Aiven
- `DB_NAME` - Nom de la base
- `DB_SSL` - true
- `SESSION_SECRET` - Secret de session (généré automatiquement)
- `NODE_ENV` - production

## Tests

### Test de connexion

```bash
node -e "import('./src/lib/sql-db.js').then(m => m.testConnection())"
```

### Test des requêtes

```bash
npm run dev
```

## Limitations actuelles

1. **Helpers simplifiés**: Les helpers SQL actuels ne supportent pas toutes les fonctionnalités Prisma avancées (relations, transactions complexes)
2. **Type safety**: Moins de type safety qu'avec Prisma
3. **Migrations**: Les migrations doivent être gérées manuellement avec SQL

## Améliorations futures

1. Ajouter le support des transactions
2. Améliorer le type safety avec TypeScript
3. Ajouter un système de migrations SQL
4. Optimiser les requêtes avec des indexes
5. Ajouter le support des relations complexes

## Rollback

Si nécessaire, revenir à Prisma:

1. Réinstaller Prisma: `npm install @prisma/client prisma`
2. Restaurer `prisma/schema.prisma`
3. Restaurer `src/lib/db.ts` avec PrismaClient
4. Exécuter `npx prisma generate`
5. Restaurer les scripts package.json

## Support

Pour toute question sur la migration, consulter:
- Documentation Aiven MySQL
- Documentation Render
- Documentation mysql2
