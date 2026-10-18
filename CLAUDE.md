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

<!-- agent-roster:start -->
## Agent roster and model routing

- Role agents live in `.claude/agents/` (Claude Code) and `.codex/agents/` (Codex) under the same names. Each role has one canonical model and effort (Model column). A runtime runs it natively when the model is from its provider; otherwise the agent file is a thin bridge that calls the other CLI, or falls back to the nearest native model (shown in that runtime's column). Re-run the roster installer instead of hand-editing models or effort.
- Pick the most specific role for the work. Every migration gets a `security-reviewer` pass, and `verifier` checks execution work before it is accepted.
- Workflow skills (arena, architect, swarm, interrogate, hillclimb, how, why, reflect) live in `.agents/skills/` (Codex) with symlinks in `.claude/skills/` (Claude Code); each spawns the role agents listed in its `## Agents` section.

| Agent | Group | Model | Claude Code | Codex | Use for |
|---|---|---|---|---|---|
| `planner` | plan | `gpt-6-astra · xhigh` | bridge (codex exec) | native | Decomposing multi-step work into ordered, verifiable tasks |
| `hardest-tasks` | heavy | `claude-opus-5-5 · xhigh` | native | bridge (claude -p) | Hardest, ambiguous, or cross-cutting implementation work |
| `judgment-prose` | heavy | `claude-opus-5-5 · high` | native | bridge (claude -p) | Design tradeoffs, technical docs, PR narratives, client explanations |
| `security-reviewer` | heavy | `claude-opus-5-5 · xhigh` | native | bridge (claude -p) | Tenant isolation, authz, and secrets review; required for migrations |
| `how-explainer` | heavy | `claude-opus-5-5 · high` | native | bridge (claude -p) | Explaining how a subsystem works, with file:line citations |
| `why-synthesizer` | heavy | `claude-opus-5-5 · high` | native | bridge (claude -p) | Cited account of why something is the way it is |
| `reflect-reviewer` | heavy | `claude-opus-5-5 · xhigh` | native | bridge (claude -p) | Reflect review from one lens (judgment, divergent) or as synthesizer |
| `architect-runner` | panel | `claude-opus-5-5 · xhigh` | native | bridge (claude -p) | Design sketch in its own worktree before code |
| `architect-runner-cross` | panel | `gpt-6.1-sol · xhigh` | bridge (codex exec) | native | Design sketch in its own worktree before code (second model) |
| `arena-runner` | panel | `claude-opus-5-5 · xhigh` | native | bridge (claude -p) | One independent arena candidate, built without seeing others |
| `arena-runner-cross` | panel | `gpt-6.1-sol · xhigh` | bridge (codex exec) | native | One independent arena candidate, built without seeing others (second model) |
| `arena-judge` | panel | `claude-opus-5-5 · xhigh` | native | bridge (claude -p) | Scoring arena candidates, picking a base, naming parts to graft |
| `arena-judge-cross` | panel | `gpt-6.1-sol · xhigh` | bridge (codex exec) | native | Scoring arena candidates, picking a base, naming parts to graft (second model) |
| `interrogate-reviewer` | panel | `claude-opus-5-5 · xhigh` | native | bridge (claude -p) | Adversarial diff or plan review from one assigned angle |
| `interrogate-reviewer-cross` | panel | `gpt-6.1-sol · xhigh` | bridge (codex exec) | native | Adversarial diff or plan review from one assigned angle (second model) |
| `bug-fix` | execution | `gpt-6.1-sol · high` | bridge (codex exec) | native | Failing test first, then root-cause fix |
| `perf-issue` | execution | `gpt-6.1-sol · high` | bridge (codex exec) | native | Performance fixes, with before and after measurements |
| `migration` | execution | `gpt-6.1-sol · high` | bridge (codex exec) | native | Database migrations and access policies, with tenant-isolation tests |
| `data-pipeline` | execution | `gpt-6.1-sol · high` | bridge (codex exec) | native | Data transformation, warehouse, and ingestion changes, with reconciled numbers |
| `hillclimb` | execution | `gpt-6.1-sol · high` | bridge (codex exec) | native | One hillclimb attempt: change, measure, report |
| `feature` | execution | `claude-sonnet-5-5 · medium` | native | bridge (claude -p) | Specified feature or refactor, with tests |
| `swarm-worker` | execution | `claude-sonnet-5-5 · medium` | native | bridge (claude -p) | One slice of a parallel fan-out, nothing outside it |
| `verifier` | execution | `claude-sonnet-5-5 · medium` | native | bridge (claude -p) | Running tests and builds to check work; reports, never fixes |
| `how-explorer` | gather | `claude-sonnet-5-5 · medium` | native | bridge (claude -p) | File:line map of a code path for a how question |
| `why-investigator` | gather | `claude-sonnet-5-5 · medium` | native | bridge (claude -p) | Cited raw evidence from one source category for a why question |
| `reflect-tooling` | gather | `claude-sonnet-5-5 · medium` | native | bridge (claude -p) | Tooling-lens reflect review: commands, paths, missed lookups |
| `clerk` | light | `claude-haiku-5-5 · low` | native | bridge (claude -p) | PR descriptions, task tracker entries, changelog lines |
| `quick-fix` | light | `claude-haiku-5-5 · low` | native | bridge (claude -p) | Typo, rename, one-line change, config value, single-fact lookup |

### When to use which

| Situation | Use |
|---|---|
| Multi-step work that needs decomposing before anyone builds | `planner`, then dispatch its tasks to the named roles |
| Typo, rename, one-liner, or single-fact lookup | `quick-fix` |
| Hard, ambiguous, or cross-module implementation | `hardest-tasks`, then `verifier` |
| Specified feature or refactor | `feature`, then `verifier` |
| Bug with a known symptom | `bug-fix`, then `verifier` |
| One slow path with a measurable cost | `perf-issue`, then `verifier` |
| Push one metric to a target over many attempts | **hillclimb** skill |
| Database migration or access-policy change | `migration`, then `security-reviewer`, then `verifier` |
| Data transformation, warehouse, or ingestion change | `data-pipeline`, then `verifier` |
| How does X work, or where should new code live | **how** skill |
| Why is X this way, a regression, or a postmortem | **why** skill |
| Non-trivial design where jumping to code would lock in the wrong shape | **architect** skill |
| Several plausible shapes for one artifact | **arena** skill |
| Before merging a risky diff, or when asked to stress-test | **interrogate** skill (adds `security-reviewer` for auth, data access, or secrets) |
| Many independent slices, races, or coverage sweeps | **swarm** skill |
| User says reflect, or a long session had repeated corrections (offer, don't auto-run) | **reflect** skill |
| Tradeoff write-ups, docs, PR narratives | `judgment-prose` |
| PR descriptions, tracker entries, changelog | `clerk` |
<!-- agent-roster:end -->
