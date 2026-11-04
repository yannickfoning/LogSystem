-- Migration neutralisee : cette migration supprime toutes les donnees et contient des mots de passe en dur
-- Elle est marquee comme appliquee dans schema_migrations et ne sera plus executee
-- Pour un reset propre, utilisez npm run db:reset -- --confirm
SELECT 1 AS noop;
