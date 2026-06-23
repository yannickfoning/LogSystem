# Fichiers SQL — LogSystem

Ce document décrit quels fichiers SQL existent dans le dépôt et comment ils sont appliqués.

## Fichiers actifs (automatiques)

| Fichier | Rôle |
|---|---|
| `db/schema.sql` | Schéma initial (`users`, `logs`, `alert_rules`, etc.). Appliqué **automatiquement** par `migrationRunner.js` comme migration virtuelle `000_initial_schema.sql` lorsque la base est vide. |
| `db/migrations/*.sql` | Migrations incrémentielles, triées alphabétiquement après le schéma initial. Ignorer les fichiers `*.disabled`. |

Le runner est invoqué au démarrage de `server.js` si `RUN_MIGRATIONS_ON_START` n'est pas `false`.

### Comportement attendu au premier démarrage

Sur une base MySQL **vide** :

1. `db/schema.sql` crée toutes les tables de base.
2. Les migrations dans `db/migrations/` appliquent les évolutions (métadonnées v6, rôle `analyst`, index, table `anomalies`, etc.).
3. Le serveur **refuse de démarrer** si une table critique manque encore (`users`, `logs`, `alert_rules`, `alerts`, `import_jobs`, `audit_log`, `error_groups`, `watch_offsets`).

Les erreurs bénignes (colonne/index déjà existant) sont ignorées. Les erreurs `ER_NO_SUCH_TABLE` **ne sont jamais ignorées**.

## Fichiers supprimés (obsolètes)

Les fichiers suivants étaient des scripts manuels ou des dumps jamais exécutés par le runner. Leur contenu utile a été intégré dans `db/schema.sql` + `db/migrations/` :

| Ancien fichier | Statut |
|---|---|
| `db/indexes.sql` | Doublon — index couverts par `add_composite_indexes.sql`, `20260619_alert_indexes.sql`, etc. |
| `db/log.sql` | Dump phpMyAdmin historique — non maintenu |
| `db/migration_resolved_at.sql` | Intégré dans `migrate_v4_to_v5.sql` |
| `db/migration_v5.sql` | Syntaxe MySQL 8 (`IF NOT EXISTS` sur ALTER) incompatible ; table `anomalies` extraite dans `20260620_anomalies_table.sql` |
| `db/setup-aiven.sql` | Setup manuel Aiven remplacé par le runner automatique |

## Scripts manuels (secours uniquement)

| Script | Usage |
|---|---|
| `scripts/setup/apply-schema.js` | Applique uniquement `db/schema.sql` — **préférer** `node server.js` |
| `npm run create-admin` | Crée/met à jour les comptes admin et user par défaut (après migrations) |

## Vérification

```bash
# Lister les tables après démarrage
node scripts/maintenance/list-tables.js
```
