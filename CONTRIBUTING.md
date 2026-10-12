# Contributing

## Set up a checkout

Install Node.js 24 and pnpm 10.34.5. The app lives in `web/`.

```sh
cd web
pnpm install
cp .env.example .env.local
```

`.env.local` needs a Postgres database in `DATABASE_URL`. The example points at `postgres://postgres:postgres@localhost:5432/emme_scheduler`. Apply migrations, then start the app.

```sh
pnpm run migrate
pnpm dev
```

To run the Docker stack instead, follow [Self-hosting Uptempo](docs/self-hosting.md) from the repository root.

## Run GATE

GATE is the check that must pass before a change is done. Run it from `web/`.

```sh
pnpm run lint && pnpm exec tsc --noEmit && pnpm test && pnpm run build && pnpm run test:db && pnpm run test:e2e
```

## Sign your commits

Contributions use the [Developer Certificate of Origin](https://developercertificate.org). There is no contributor license agreement.

`git commit -s` adds a `Signed-off-by` line. That line is your certificate. Add it on every commit.
