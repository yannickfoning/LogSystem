# TODO (LogSystem V4)

## Étape A — Audit ciblé (fait / en cours)
- [x] Lire schéma SQL (`db/schema.sql`) + indexation (`db/indexes.sql`).
- [x] Lire routes critiques :
  - [x] `routes/logs.js`
  - [x] `routes/dashboard.js`
- [x] Lire services critiques :
  - [x] `workers/alertWorker.js`
  - [x] `services/cacheService.js`
  - [x] `middleware/auth.js`
- [ ] Valider la multi-isolation côté lecture d’alertes (SSE + routes) : scénarios user/admin.
- [x] Rechercher `innerHTML`/XSS et valider le rendu côté `public/*html` et `public/*js` (premier passage).
- [ ] Rechercher les requêtes sans `userScope`/scoping (risque fuite multi-tenant).

- [ ] Faire un mini “threat model” CSRF/CSP/session + surfaces injection (imports, message logs, stack traces).


## Étape B — Corrections & améliorations (à partir de l’audit)
- [ ] Scoper strictement tout ce qui est diffusé (SSE, endpoints JSON) au tenant.
- [ ] Sécuriser l’affichage front (escape HTML strict messages/stack).
- [ ] Ajuster index/queries si des endpoints causent des scans (benchmark).
- [ ] Renforcer anti-spam alerting (cooldown par fingerprint + limites).

## Étape C — Livraison
- [ ] Run `npm test`.
- [ ] Démarrer serveur et vérifier : import, watchlog live, SSE alertes filtrées, search/pagination.

