# LogSystem Functional Test Report

## Summary

This report documents the functional status of the platform based on repository inspection and the test scripts available in the project. The repository includes a Node.js/Express application with MySQL and optional Redis, a Render deployment configuration, and a Vitest suite.

## 1. Required commands

Run from the project root:

```bash
npm install
npm test
npm run lint
```

Optional startup smoke check:

```bash
node server.js
curl http://localhost:10000/health
```

## 2. What I verified from the code

### Backend startup and health
- The application starts via `server.js`.
- `/health` is defined and checks DB connectivity.
- The app waits for DB before enabling the health endpoint as ready.
- Render-specific config is detected by `process.env.RENDER`.

### Retention and purge flows
- Retention is implemented in `services/retentionService.js`.
- Purge is implemented in `routes/admin.js`.
- These operations are intended to delete data from `logs`, `error_groups`, and `alerts`.
- The risk is schema drift on production: the code assumes compatibility across these tables and columns, but production can contain partially migrated schemas.

### Admin UI flows
- UI buttons for retention and purge exist in `public/admin.html`.
- The associated frontend handlers send `POST /api/admin/retention/run` and `POST /api/admin/purge`.
- These calls will fail if the backend DB schema is not in the expected shape.

### Database migrations
- A large number of migrations are present in `db/migrations`.
- This indicates the project has undergone schema evolution and likely some drift risk in production.

## 3. Likely functional issues

### Issue A — Purge/retention are unsafe in production
This is the main functional issue.

Why:
- The purge endpoint updates/dereferences `error_groups.sample_log_id` before deleting `logs`.
- The retention job deletes records from `logs` and `error_groups`, then old rows from `alerts`.
- This logic depends on exact table/column names and schema compatibility.
- In production, a partially migrated database can trigger SQL errors even though the UI button looks valid.

Result:
- Buttons appear to work, but the backend returns error responses and no successful purge occurs.

### Issue B — Health endpoint is not enough
The `/health` endpoint checks DB availability but does not validate:
- admin account creation
- user login
- log import pipeline
- retention execution after cleanup
- alert evaluation rules
- SSE/real-time streams

This means a service may report healthy while key business features still fail.

### Issue C — Render deployment is optimized for a single runtime, but data integrity is externalized
The app uses a MySQL database externally and intentionally disables Redis on Render. That is acceptable, but it makes the app highly dependent on DB schema correctness.

### Issue D — No production regression gate in CI
There is no GitHub Actions workflow file in the repository for automated tests or deployment checks visible from the repository contents.

## 4. What deserves improvement

### High priority
1. Harden purge and retention against missing or mismatched schema.
2. Add SQL guards and graceful fallback logic for missing columns/tables.
3. Add a dedicated health endpoint that includes app business readiness, not just DB connectivity.
4. Add automated CI tests for purge and retention operations.

### Medium priority
1. Add a “dry-run” purge/retention mode to preview deletions before executing.
2. Add explicit audit details for retention and purge results.
3. Add stronger tests for migration drift across production-like schemas.
4. Improve error propagation to the UI so the admin sees the exact reason.

### Lower priority
1. Add a dedicated dashboard for DB size, purge stats, retention stats, and orphan data.
2. Improve logs around retention to help diagnose failures faster.
3. Consider a dedicated maintenance script for production resets and cleanup.

## 5. Overall verdict

The platform is functionally close to a production-ready monitoring system, but the purge/retention modules are the main reliability issue. The project has broad functionality and many migrations, but it is still vulnerable to schema drift and production-only edge cases. The admin actions should be hardened before calling the platform stable.

## 6. Recommended next actions

1. Fix purge/retention schema guards.
2. Run `npm test` locally in a clean environment.
3. Test admin purge + retention through the UI.
4. Confirm a database reset path with a fresh MySQL schema.
5. Add CI coverage for these admin operations.

## 7. Important note

This report is based on repository inspection and available test scripts. It is not a replacement for a live Render/Aiven smoke test against the real deployment.
