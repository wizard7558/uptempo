#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  echo ".env already exists. Refusing to overwrite it." >&2
  exit 1
fi

pg_pass="$(openssl rand -hex 16)"
auth_secret="$(openssl rand -hex 32)"
booking_secret="$(openssl rand -hex 32)"
cron_secret="$(openssl rand -hex 32)"

sed \
  -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=${pg_pass}/" \
  -e "s|^DATABASE_URL=.*|DATABASE_URL=postgres://uptempo:${pg_pass}@db:5432/uptempo|" \
  -e "s/^BETTER_AUTH_SECRET=.*/BETTER_AUTH_SECRET=${auth_secret}/" \
  -e "s/^BOOKING_SESSION_SECRET=.*/BOOKING_SESSION_SECRET=${booking_secret}/" \
  -e "s/^CRON_SECRET=.*/CRON_SECRET=${cron_secret}/" \
  .env.example > .env

echo "Wrote .env"
