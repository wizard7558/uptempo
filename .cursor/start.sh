#!/usr/bin/env bash
# Per-boot service startup: bring up local PostgreSQL (both DB modes; remote
# mode keeps it available for throwaway databases) and wait up to 30s.
# Idempotent; recovers from a stale postmaster.pid. In remote mode a quick
# connectivity check runs but only warns. The dev server runs from the `dev`
# terminal.
set -euo pipefail

PG_VERSION="$(find /usr/lib/postgresql -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | sort -V | tail -1 || true)"
PG_VERSION="${PG_VERSION:-16}"

is_ready() { pg_isready -h 127.0.0.1 -p 5432 -q; }

remote_check() {
  [ -n "${DATABASE_URL:-}" ] || return 0
  local host
  host="$(node -e 'process.stdout.write(new URL(process.env.DATABASE_URL).hostname)' 2>/dev/null || echo unknown)"
  case "$host" in 127.0.0.1|localhost|"[::1]"|::1) return 0 ;; esac
  if timeout 10 psql "$DATABASE_URL" -tAc 'select 1' >/dev/null 2>&1; then
    echo "[start] Remote dev DB reachable (shared by all agents)."
  else
    echo "[start] WARNING: remote dev DB not reachable (continuing)." >&2
  fi
}

if is_ready; then
  echo "[start] PostgreSQL already accepting connections on 127.0.0.1:5432."
else
  echo "[start] Starting PostgreSQL ${PG_VERSION}..."
  sudo pg_ctlcluster "$PG_VERSION" main start 2>/dev/null \
    || sudo pg_ctlcluster "$PG_VERSION" main restart 2>/dev/null \
    || true
  ready=0
  for _ in $(seq 1 30); do
    if is_ready; then ready=1; break; fi
    sleep 1
  done
  if [ "$ready" -ne 1 ]; then
    echo "[start] ERROR: PostgreSQL did not become ready within 30s." >&2
    exit 1
  fi
  echo "[start] PostgreSQL is ready on 127.0.0.1:5432."
fi

remote_check || true
exit 0
