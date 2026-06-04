Migration_v6.sql added (db/migrations/migration_v6.sql).

Notes:
- Runner executes all *.sql in db/migrations sorted alphabetically.
- migration_v6.sql is intended to be idempotent via IF NOT EXISTS / WHERE NOT EXISTS.
- Alert rule seed uses (name + created_by) as uniqueness guard.

