# TODO.md

## Phase V6 - Audit fixes (Approuvé)

### Phase 4 — timestamps enrichis
- [x] Uniformiser `file_created_at` / `file_modified_at` dans `lib/processing/archiveHandler.js` pour **ZIP / TAR / TAR.GZ / GZ** (fs.stat sur fichiers extraits temp)

- [x] Maintenir la récursion nested archives (détection archives dans le temp)

- [x] Garantir que chaque item retourné contient toujours `file_created_at` & `file_modified_at` (même si null)


### Phase 5 — persistance
- [ ] Vérifier que `routes/import.js` persiste bien `file_created_at` & `file_modified_at` dans `logs` (déjà présent)

### Phase 2 — responsive global dashboard
- [x] Vérifier si le bloc responsive est déjà présent dans `public/dashboard.css`
- [x] Sinon injecter le bloc à la fin du fichier


### Phase 8 — anomalies z-score
- [x] Créer `services/anomaliesService.js` avec `detectVolumeAnomalies(userId)` (Z-Score)

- [x] Ajouter le wiring : appeler la détection depuis `services/alertEngine.js`


### Verification
- [ ] Appliquer migration V6 via `lib/database/migrationRunner.js`
- [ ] Tester l’import sur un archive nested (zip -> tar.gz -> log) et vérifier les champs timestamps en DB
- [ ] Lancer tests (vitest) si dispo

