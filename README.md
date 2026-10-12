# Uptempo

Uptempo Bookings is scheduling software for appointment businesses. An owner keeps a calendar, publishes a booking page, and takes payment. The hosted service at bookuptempo.com and a self-hosted install run this same repository.

## Hosted and self-host

| | Hosted | Self-host |
| --- | --- | --- |
| Who runs it | Uptempo, at bookuptempo.com | You, on a machine you control |
| Businesses | Many businesses on one platform | One business |
| Start | Create an account on the hosted site | `./scripts/init-env.sh`, then `docker compose up -d` |
| Database | Included | Postgres 17 in Compose, or your own Postgres 15 or newer |
| Files | Hosted storage | A local disk volume, or any S3-compatible bucket |
| Email | Resend | Printed to the logs, SMTP, or Resend |
| Text messages | Twilio, after US carrier registration | Off, or your own Twilio account |
| Platform fee | Can apply on card payments | None |
| iOS apps | Uptempo and Uptempo Pro open the hosted site | Uptempo and Uptempo Pro still open the hosted site |

Details, limits, and configuration are in [Self-hosting Uptempo](docs/self-hosting.md).

## Quickstart

```sh
git clone https://github.com/wizard7558/uptempo
cd uptempo
./scripts/init-env.sh
docker compose up -d
```

`init-env.sh` writes `.env` and refuses to overwrite a file that is already there. Then open the site, complete `/setup`, finish onboarding, and book at `/book/<your-slug>`.

## License

The license is the GNU Affero General Public License version 3.0 only (`AGPL-3.0-only`). The text is in `LICENSE`.
