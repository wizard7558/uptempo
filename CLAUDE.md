# Claude Code Configuration - BookUpTempo (Emme Scheduler)

## Project Overview

Multi-tenant SaaS salon booking platform centered on:
- `web/` — Next.js 15 full-stack app

## Behavioral Rules (Always Enforced)

- Do what has been asked; nothing more, nothing less
- NEVER create files unless absolutely necessary for achieving your goal
- ALWAYS prefer editing an existing file to creating a new one
- NEVER proactively create documentation files (*.md) or README files unless explicitly requested
- NEVER save working files, text/mds, or tests to the root folder
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15.5 (App Router, Turbopack) |
| UI | React 19, Tailwind CSS 4, Radix UI, shadcn |
| Language | TypeScript 5 (strict mode) |
| Database | PostgreSQL 17, Drizzle ORM |
| Auth | Better Auth |
| Payments | Stripe |
| Calendar | Google Calendar (direct OAuth) |
| Email | Resend + React Email |
| SMS | Twilio |
| Testing | Vitest (unit), Playwright (E2E) |
| Deployment | Vercel |

## Domain Models

Core bounded contexts in `web/src/lib/db/schema/`:
- **Tenants** — multi-tenant isolation
- **Salons** — business entities with policies
- **Stylists** — service providers with working hours
- **Services** — offered services with stylist assignments
- **Clients** — customer records (platform-wide + per-salon)
- **Appointments** — bookings with service line items and charges
- **Calendar Connections** — Cronofy calendar sync with external events
- **Booking Verification** — verification codes for public booking flow

## File Organization

```
book-uptempo/
├── web/
│   ├── src/
│   │   ├── app/           # Next.js App Router
│   │   │   ├── (admin)/   # Admin dashboard (authenticated)
│   │   │   ├── (auth)/    # Auth pages (login/signup)
│   │   │   ├── (booking)/ # Public booking flow
│   │   │   └── api/       # API routes
│   │   ├── actions/       # Server actions
│   │   ├── components/    # React components
│   │   ├── emails/        # Email templates
│   │   ├── hooks/         # Custom React hooks
│   │   └── lib/           # Utilities, DB schema, auth config
│   ├── tests/e2e/         # Playwright E2E tests
│   ├── drizzle/           # DB migrations
│   └── scripts/           # Utility scripts
```

## Build & Test

All commands run from `web/` directory:

```bash
# Development
cd web && npm run dev

# Build
cd web && npm run build

# Unit tests
cd web && npm test

# E2E tests
cd web && npm run test:e2e

# Lint
cd web && npm run lint

# Database migrations (public schema + all tenants)
cd web && npm run migrate

# Same migrations against **production** Postgres (pulls DATABASE_URL from Vercel Production)
cd web && npm run migrate:production

# Dev (.env.local) then production in one command (use after every migration change)
cd web && npm run migrate:dev-and-production

# Generate new public-schema migration SQL after schema edits
cd web && npx drizzle-kit generate
# Apply public-schema migrations only: npm run migrate:platform
# Apply tenant migrations only: npm run migrate:tenants
```

**After adding or changing DB migrations** (public `drizzle/` SQL or tenant migrations under `src/lib/tenant/migrations/`), apply them to **both** databases the app uses. **Vercel does not run migrations on deploy** — you must run them explicitly.

| Command | What it migrates |
|---------|------------------|
| `npm run migrate` | Whatever `DATABASE_URL` is in **`.env.local`** (your dev DB). |
| `npm run migrate:production` | **Production** `DATABASE_URL` from Vercel (`vercel env pull` → migrate → delete pulled file). Requires `vercel link` + login. |
| `npm run migrate:dev-and-production` | **Both**, in order: dev first, then production. **Prefer this when shipping schema changes** so you never ship code without hitting prod. |

**CI (GitHub Actions):** On push to `main` when migration-related paths change, [`.github/workflows/migrate-production.yml`](.github/workflows/migrate-production.yml) runs `npm run migrate` with `DATABASE_URL` from the repo secret **`PRODUCTION_DATABASE_URL`** (set it under GitHub → repo → **Settings → Secrets and variables → Actions**; value must match Vercel **Production** `DATABASE_URL`, typically your Neon pooled URL). You can also run the workflow manually (**Actions → Migrate production database → Run workflow**).

Manual production option (equivalent to `migrate:production`): `npx vercel env pull .env.production.local --environment=production`, then `set -a && source .env.production.local && set +a && npm run migrate` in zsh/bash, then `rm .env.production.local`. Do not commit `.env*` files.

Skipping either environment leaves that DB out of sync with the code and causes runtime errors (missing columns, wrong `schema_version`, etc.).

**Common symptom — users cannot log in (e.g. salon staff / “Emma”):** After a migration ships or code deploys before the DB is migrated, auth and tenant queries can fail. **First response:** run `npm run migrate:dev-and-production` from `web/`, or migrate each environment separately. This is expected whenever migrations land; do not assume the DB updated itself on deploy.

- ALWAYS run tests after making code changes
- ALWAYS verify build succeeds before committing
- Path alias: `@/*` maps to `./src/*` in web

## Testing Conventions

- **Unit tests**: Vitest, co-located with source as `*.test.ts`
- **E2E tests**: Playwright in `tests/e2e/`
  - `setup` project seeds admin session → `.auth/admin.json`
  - `admin` project uses stored auth state
  - `booking` project runs without auth (public flow)
  - External services (Stripe, Cronofy, Resend) mocked via `page.route()`

## Security Rules

- NEVER hardcode API keys, secrets, or credentials in source files
- NEVER commit .env files or any file containing secrets
- Always validate user input at system boundaries
- Always sanitize file paths to prevent directory traversal

## Concurrency

- ALWAYS batch ALL file reads/writes/edits in ONE message
- ALWAYS batch ALL Bash commands in ONE message
