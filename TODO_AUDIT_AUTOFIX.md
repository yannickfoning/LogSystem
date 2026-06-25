# TODO — Audit & Correction Auto (LogSystem V4)

## 1) Audit & fixes sécurité + isolation (priorité haute)
- [ ] Vérifier tous les endpoints listés (logs/import/alerts/stats/trends/exports/audit) : `user_id` appliqué partout.
- [x] Corriger SSE `/api/alerts/stream` (doublon probable côté server.js vs dashboard.js).
- [x] Corriger watch SSE `/watch/stream` : vérifier scope user (bug potentiel `userScope(user.id)`).
- [ ] Vérifier cache Redis : clés par user.

## 2) WatchLog temps réel + tendances
- [ ] Vérifier insertion logs par watcher : colonnes & mapping user_id.
- [ ] Vérifier diffusion temps réel WatchLog → frontend : events, filtre jour, absence d’erreurs console.
- [ ] Vérifier `/trends` : filtre périodes, timezone, niveaux (CRITICAL vs ERROR etc.).

## 3) Erreurs fréquentes / détail groupe
- [ ] Vérifier route `/analysis/:fingerprint` : scope et données (stack_trace/module/target_user).
- [ ] Vérifier UI bouton “erreur fréquente” et fenêtre détail.

## 4) Alertes temps réel
- [ ] Vérifier `alertEngine` + `alertWorker` + règles : déclenchement, cooldown, time_window.
- [ ] Vérifier badges & synchro SSE.

## 5) Imports + schéma de logs
- [ ] Vérifier schéma : user_id, timestamp heure exacte, module/source/message/stack_trace/env/IP.
- [ ] Vérifier parsers universalParser + validation + résumé import.

## 6) Recherches/filtre/pagination
- [ ] Vérifier “Dernière heure / Aujourd’hui / 24h / 7 jours”, recherche texte, pagination, tri, timezone.
- [ ] Corriger si SQL incorrect ou validations manquantes.

## 7) i18n + exports
- [ ] Scanner `public/i18n.js` et pages pour clés manquantes.
- [ ] Vérifier export PDF/CVS : pagination/marges/coupures.

## 8) Tests globaux
- [ ] Lancer vitest + scripts de diagnostic.
- [ ] Ajouter tests multi-utilisateurs de scoping.

## 9) Rapport final
- [ ] Produire `AUDIT_REPORT.md` / `docs/AUDIT_RAPPORT.md` consolidé : scores sécurité/perf/stabilité/UX et liste corrections.

