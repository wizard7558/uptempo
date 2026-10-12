#!/bin/sh
set -eu
node scripts/check-local-bootstrap.mjs --env-only
node scripts/db-prepare.mjs
node scripts/migrate-platform.mjs
pnpm exec tsx scripts/migrate-tenants.ts
echo "[migrate] done"
