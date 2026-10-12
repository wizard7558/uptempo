Public-schema changes are driven by `src/lib/db/schema/` and the SQL files in this folder.

- **Local / deploy:** run `npm run migrate` from `web/` (runs `drizzle-kit migrate` plus tenant migrations). The migrate script baselines `drizzle.__drizzle_migrations` when the DB was previously synced with `drizzle-kit push` only.
- **CI (fresh Postgres):** `.github/workflows/e2e.yml` uses `npx drizzle-kit push` on an empty database.

The SQL files in this directory are the canonical migration trail for `drizzle-kit migrate`, snapshots, and review.

Notes:
- `0010_public_schema_catchup.sql` is the canonical reconciliation point that
  brings Drizzle's journal and snapshots back in sync with the current schema.
- `legacy/` contains older hand-written SQL patches that were useful during the
  push-only phase but were never part of Drizzle's metadata journal.
