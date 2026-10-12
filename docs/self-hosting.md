# Self-hosting Uptempo

Uptempo runs one business on a machine you control. The license is AGPL-3.0. You get booking, the owner dashboard, email, optional Stripe charges, and optional SMS. Platform fees and hosted signup stay off.

## Requirements

Docker 24 or newer, about 2 GB of RAM, and Postgres 15 or newer with the `btree_gist` extension. The database owner can create that extension.

## Quickstart

From the repository root:

```sh
./scripts/init-env.sh
docker compose up -d
```

Open the site, complete `/setup` (pick an industry), finish the onboarding wizard, then book at `/book/<your-slug>`.

## Configuration

`web/env.registry.json` lists every variable. Single-mode installs need `DATABASE_URL`, `APP_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `BOOKING_SESSION_SECRET`, `CRON_SECRET`, and `UPTEMPO_WORKER_TARGET_URL`. `./scripts/init-env.sh` writes a `.env` with generated secrets.

`node scripts/check-local-bootstrap.mjs --env-only` checks the current mode. A missing variable is printed with its group, for example `- APP_URL (core): required`.

## External Postgres

Remove `db` from `COMPOSE_PROFILES` and set `DATABASE_URL` to your server. The database user must be allowed to run `CREATE EXTENSION btree_gist`.

## Files

Uploads stay on the `uploads` volume when `STORAGE_PROVIDER=local`. For S3, R2, or MinIO, set `COMPOSE_PROFILES=db,s3` and the `S3_*` variables. `S3_ENDPOINT` is where the server writes. `S3_PUBLIC_URL` is the browser-facing base for those objects.

## Email

`EMAIL_PROVIDER=console` prints mail to the logs. For delivery, set `EMAIL_PROVIDER=smtp` and `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and `SMTP_PASSWORD`. Postmark, Amazon SES, and Fastmail all speak SMTP. `EMAIL_PROVIDER=resend` uses `RESEND_API_KEY` instead.

## Payments

Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`. Point a Stripe webhook at `${APP_URL}/api/stripe/webhook`. Subscribe to `account.updated`, `payout.paid`, `payout.failed`, `checkout.session.completed`, `setup_intent.succeeded`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, and `customer.subscription.deleted`. Charges go to your Stripe account. Single mode does not add a platform fee.

## Texts

SMS is off until `SMS_PROVIDER=twilio`. You need `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_MESSAGING_SERVICE_SID`. US A2P 10DLC brand and campaign registration is yours to complete, and it can take days.

## Custom domain and TLS

Terminate TLS in Caddy or nginx and proxy to port 3000. Set `APP_URL` and `BETTER_AUTH_URL` to the public origin. Rebuild the web image when a `NEXT_PUBLIC_*` value changes, because those are inlined at build time.

```
example.com {
  reverse_proxy web:3000
}
```

```
server {
  listen 443 ssl;
  server_name example.com;
  location / { proxy_pass http://127.0.0.1:3000; }
}
```

## Scheduled jobs

The worker container calls the app on the same schedules as the hosted crons. It records each slot in `job_runs`. Two workers are safe: one claims the slot, and an advisory lock stops a second copy of the same job from overlapping.

## Upgrades

```sh
git pull
docker compose up -d --build
```

The migrate service applies schema changes before the app starts.

## Backups and restore

Dump Postgres with `pg_dump` and copy the uploads volume. Restore the dump, then start the stack again.

## Limits

One business, and one web replica (the first-run lock is in that process). The iOS apps load the hosted site. Google Calendar needs your own OAuth client in `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET`.

## AGPL

If you modify the code and run it for other people, set `UPTEMPO_SOURCE_URL` to the source you offer them.

## Troubleshooting

`node scripts/check-local-bootstrap.mjs --env-only` prints the variable and the group that failed. `docker compose logs migrate` shows schema errors. `docker compose logs worker` shows `[worker] ran <id> <status>`.
