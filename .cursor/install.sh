#!/usr/bin/env bash
# Idempotent bootstrap for the BookUpTempo (Emme Scheduler) Cursor Cloud Agent.
# Assumes an Ubuntu image with apt, sudo (passwordless) and curl.
#
# - Node 22 (>=22.12), pnpm via corepack, Playwright chromium + system deps
# - CLIs: gh, vercel, stripe, psql (each guarded by `command -v`)
# - Database mode:
#     remote: DATABASE_URL (Cursor secret) points at a non-local host. Only a
#             connectivity check is run; NO schema change is ever made.
#     local : no DATABASE_URL, or it points at localhost. Provisions a local
#             Postgres, pushes the schema, migrates and seeds test-salon.
#   Postgres is installed in BOTH modes so agents can spin up a throwaway DB.
# - Secrets are never written to disk (only IDs in .vercel/project.json). The
#   fallback .env.local holds random local-only values; process.env wins.
# Safe to re-run. Per-boot startup lives in start.sh.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$REPO_ROOT/web"
NODE_MAJOR=22          # CI (migrate-production.yml) uses 22; vitest 4 needs >=20.19/22.12
NODE_MIN_MINOR=12      # minimum 22.x minor accepted
VERCEL_MAJOR=63
PG_VERSION=16
LOCAL_DB_URL="postgres://postgres:postgres@127.0.0.1:5432/emme_scheduler"

log()  { echo "[install] $*"; }
warn() { echo "[install] WARNING: $*" >&2; }
have() { command -v "$1" >/dev/null 2>&1; }
apt_install() {
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@"
}

node_ok() {
  have node || return 1
  local v major minor
  v="$(node -v | sed 's/^v//')"
  major="${v%%.*}"
  minor="${v#*.}"; minor="${minor%%.*}"
  if [ "$major" -gt "$NODE_MAJOR" ]; then return 0; fi
  [ "$major" -eq "$NODE_MAJOR" ] && [ "$minor" -ge "$NODE_MIN_MINOR" ]
}

# --- Base packages -----------------------------------------------------------
log "Ensuring base packages (curl, gnupg, openssl, ca-certificates)..."
sudo apt-get update -qq
apt_install ca-certificates curl gnupg openssl

# --- Node --------------------------------------------------------------------
if node_ok; then
  log "Node $(node -v) is compatible; skipping install."
else
  log "Installing Node ${NODE_MAJOR}.x from NodeSource..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash - >/dev/null
  apt_install nodejs
  hash -r
  node_ok || { echo "[install] ERROR: Node ${NODE_MAJOR}.>=${NODE_MIN_MINOR} not active (found: $(node -v 2>/dev/null || echo none)); check PATH ordering." >&2; exit 1; }
fi

# --- pnpm via corepack -------------------------------------------------------
PNPM_VERSION="$(node -p "(require('$APP_DIR/package.json').packageManager||'').replace(/^pnpm@/,'').split('+')[0]")"
[ -n "$PNPM_VERSION" ] || { echo "[install] ERROR: packageManager missing in package.json" >&2; exit 1; }
if have corepack; then
  corepack enable >/dev/null 2>&1 || sudo corepack enable
  corepack prepare "pnpm@${PNPM_VERSION}" --activate >/dev/null
else
  have pnpm && [ "$(pnpm -v)" = "$PNPM_VERSION" ] || sudo npm install -g "pnpm@${PNPM_VERSION}"
fi
log "pnpm $(pnpm -v)"

# --- Postgres (server + psql client; both DB modes) ---------------------------
if ! ls /usr/lib/postgresql/*/bin/pg_ctl >/dev/null 2>&1; then
  log "Installing PostgreSQL ${PG_VERSION}..."
  apt_install "postgresql-${PG_VERSION}" postgresql-contrib 2>/dev/null \
    || apt_install postgresql postgresql-contrib
fi
PG_VERSION="$(find /usr/lib/postgresql -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -V | tail -1)"
log "PostgreSQL ${PG_VERSION}"

# --- GitHub CLI --------------------------------------------------------------
if ! have gh; then
  log "Installing gh from the GitHub apt repo..."
  sudo mkdir -p -m 755 /etc/apt/keyrings
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
  sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
  sudo apt-get update -qq
  apt_install gh
fi

# --- Stripe CLI --------------------------------------------------------------
if ! have stripe; then
  log "Installing stripe CLI from the Stripe apt repo..."
  curl -fsSL https://packages.stripe.dev/api/security/keypair/stripe-cli-gpg/public \
    | gpg --dearmor | sudo tee /usr/share/keyrings/stripe.gpg >/dev/null
  echo "deb [signed-by=/usr/share/keyrings/stripe.gpg] https://packages.stripe.dev/stripe-cli-debian-local stable main" \
    | sudo tee /etc/apt/sources.list.d/stripe.list >/dev/null
  sudo apt-get update -qq
  apt_install stripe
fi

# --- Vercel CLI --------------------------------------------------------------
if ! have vercel; then
  log "Installing vercel@${VERCEL_MAJOR}..."
  if [ -w "$(npm config get prefix)/lib" ] 2>/dev/null; then
    npm install -g "vercel@${VERCEL_MAJOR}"
  else
    sudo npm install -g "vercel@${VERCEL_MAJOR}"
  fi
fi

# --- Node dependencies + Playwright -----------------------------------------
cd "$APP_DIR"
if ! grep -q '^public-hoist-pattern\[\]=@next/env' .npmrc 2>/dev/null; then
  echo "[install] ERROR: web/.npmrc is missing the @next/env hoist (from PR #23)." >&2
  exit 1
fi
log "Installing Node dependencies (pnpm install --frozen-lockfile)..."
pnpm install --frozen-lockfile

# playwright.config.ts only uses Desktop Chrome (chromium) in all projects.
log "Installing Playwright chromium + system deps..."
PW_CLI="$(pnpm exec node -p "require.resolve('@playwright/test/cli')")"
sudo env "PATH=$PATH" node "$PW_CLI" install-deps chromium
pnpm exec playwright install chromium

# --- Non-interactive CLI auth (env-based; nothing secret written) -----------
if [ -n "${GH_TOKEN:-}" ]; then
  if gh auth status >/dev/null 2>&1; then
    log "gh authenticated via GH_TOKEN."
  else
    warn "GH_TOKEN is set but 'gh auth status' failed."
  fi
fi

if [ -n "${VERCEL_ORG_ID:-}" ] && [ -n "${VERCEL_PROJECT_ID:-}" ] \
   && [ ! -f "$APP_DIR/.vercel/project.json" ]; then
  log "Writing web/.vercel/project.json (IDs only)..."
  mkdir -p "$APP_DIR/.vercel"
  printf '{"orgId":"%s","projectId":"%s"}\n' "$VERCEL_ORG_ID" "$VERCEL_PROJECT_ID" \
    > "$APP_DIR/.vercel/project.json"
fi
ignore_rc=0
git -C "$REPO_ROOT" check-ignore -q web/.vercel/project.json || ignore_rc=$?
if [ "$ignore_rc" -eq 1 ]; then
  warn "web/.vercel is NOT gitignored; do not commit it."
fi

# shellcheck disable=SC2016 # literal reference is intended; expands at shell login
STRIPE_LINE='export STRIPE_API_KEY="${STRIPE_API_KEY:-$STRIPE_SECRET_KEY}"'
for rc in "$HOME/.bashrc" "$HOME/.profile"; do
  touch "$rc"
  grep -qxF "$STRIPE_LINE" "$rc" || printf '%s\n' "$STRIPE_LINE" >> "$rc"
done

# --- Database ----------------------------------------------------------------
DB_MODE=local
if [ -n "${DATABASE_URL:-}" ]; then
  if DB_HOST="$(DATABASE_URL="$DATABASE_URL" node -e 'process.stdout.write(new URL(process.env.DATABASE_URL).hostname)' 2>/dev/null)"; then
    case "$DB_HOST" in
      127.0.0.1|localhost|"[::1]"|::1) DB_MODE=local ;;
      *) DB_MODE=remote ;;
    esac
  else
    warn "DATABASE_URL is not parseable; treating as remote (no schema changes)."
    DB_MODE=remote
  fi
fi
log "Database mode: ${DB_MODE}"

# Fallback env file (only if absent). process.env, i.e. Cursor secrets, wins.
if [ ! -f "$APP_DIR/.env.local" ]; then
  log "Writing web/.env.local (local fallback values)..."
  cat > "$APP_DIR/.env.local" <<ENVEOF
# Local development environment (generated by .cursor/install.sh). Not committed.
# Values here are fallbacks only: process.env (Cursor secrets) takes precedence.
DATABASE_URL=${LOCAL_DB_URL}
BETTER_AUTH_SECRET=$(openssl rand -hex 32)
BETTER_AUTH_URL=http://localhost:3000
BOOKING_SESSION_SECRET=$(openssl rand -hex 32)
NEXT_PUBLIC_APP_URL=http://localhost:3000
ROOT_DOMAIN=localhost
ENVEOF
fi

start_pg() {
  sudo pg_ctlcluster "$PG_VERSION" main start 2>/dev/null \
    || sudo pg_ctlcluster "$PG_VERSION" main restart 2>/dev/null || true
  for _ in $(seq 1 30); do
    pg_isready -h 127.0.0.1 -p 5432 -q && return 0
    sleep 1
  done
  echo "[install] ERROR: local PostgreSQL did not become ready." >&2
  return 1
}

if [ "$DB_MODE" = "local" ]; then
  log "Starting local PostgreSQL for schema setup..."
  start_pg
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER USER postgres WITH PASSWORD 'postgres';" >/dev/null
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='emme_scheduler'" | grep -q 1; then
    sudo -u postgres psql -c "CREATE DATABASE emme_scheduler;"
  fi

  # Every command below pins the LOCAL url explicitly (never inherited env).
  log "Syncing public schema (drizzle-kit push) and running full migrate..."
  DATABASE_URL="$LOCAL_DB_URL" pnpm exec drizzle-kit push --force
  DATABASE_URL="$LOCAL_DB_URL" npm run migrate

  if ! psql "$LOCAL_DB_URL" -tAc "SELECT 1 FROM tenants WHERE slug='test-salon'" | grep -q 1; then
    log "Seeding demo tenant (test-salon)..."
    DATABASE_URL="$LOCAL_DB_URL" npx tsx scripts/seed-e2e-data.ts
    DATABASE_URL="$LOCAL_DB_URL" npm run migrate:tenants
  else
    log "test-salon already present; skipping seed."
  fi
else
  log "Remote DB: checking connectivity only (no push, migrate or seed)."
  if psql "$DATABASE_URL" -tAc 'select 1' >/dev/null 2>&1; then
    log "Remote DB reachable."
  else
    warn "Remote DB is not reachable with the current DATABASE_URL."
  fi
  cat <<'NOTICE'
[install] NOTICE: agents SHARE the remote dev database. install.sh makes no
[install]   schema changes to it. Delete the DATABASE_URL secret in Cursor to
[install]   switch to an isolated local database (local mode).
NOTICE
fi

# Stop Postgres so a snapshot does not capture a running server (stale
# postmaster.pid). start.sh brings it back up per boot.
log "Stopping PostgreSQL for a clean snapshot state..."
sudo pg_ctlcluster "$PG_VERSION" main stop 2>/dev/null || true

# --- Summary -----------------------------------------------------------------
ver() { "$@" 2>/dev/null | head -1 || true; }
echo
echo "[install] ===== Summary ====="
echo "[install] DB mode : ${DB_MODE}"
echo "[install] node    : $(node -v)"
echo "[install] pnpm    : $(pnpm -v)"
echo "[install] psql    : $(ver psql --version)"
echo "[install] gh      : $(ver gh --version)"
echo "[install] vercel  : $(ver vercel --version)"
echo "[install] stripe  : $(ver stripe version)"
echo "[install] playwright: $(cd "$APP_DIR" && ver pnpm exec playwright --version)"
echo "[install] Capability secrets:"
for name in GH_TOKEN VERCEL_TOKEN STRIPE_SECRET_KEY RESEND_API_KEY TWILIO_AUTH_TOKEN BLOB_READ_WRITE_TOKEN; do
  if [ -n "${!name:-}" ]; then echo "[install]   ${name}: set"; else echo "[install]   ${name}: unset"; fi
done
log "Done. After start.sh, run the dev terminal; booking demo: http://localhost:3000/book/test-salon"
