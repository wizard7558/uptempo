# Prospect Feedback Quiz (`/quiz`)

A lightweight, platform-level market-research survey. It is shared as a **private
link** (not linked from any nav, and `noindex`) so the team can drop it to
prospective solo service providers and collect "know your audience" feedback as
the product evolves.

It is **not tied to any tenant/salon** — responses live in the public schema.

## User flow

1. Prospect opens `/quiz` (no auth, renders under the `(booking)` group's
   no-tenant chrome).
2. Answers six questions — five free-text plus a 1–5 software rating. **Every
   field is skippable.**
   1. What wastes the most time in your business?
   2. If you could automate one thing, what would it be?
   3. Rate your current software (1–5)
   4. What's your favorite thing about it?
   5. What's your least favorite thing about it?
   6. If you could have any additional feature, what would it be?
3. On submit, the response is persisted and a confirmation state is shown.

The page also honors `?src=<label>` for attribution — see [Attribution & QR
codes](#attribution--qr-codes).

## Pieces

| Concern | File |
| --- | --- |
| Page (server) | `src/app/(booking)/quiz/page.tsx` |
| Form (client) | `src/app/(booking)/quiz/quiz-form.tsx` |
| Server action | `src/actions/quiz.ts` (`submitQuizResponse`) |
| Table (public schema) | `src/lib/db/schema/quiz-responses.ts` → `quiz_responses` |
| Migrations | `drizzle/0018_quiz_responses.sql`, `drizzle/0019_quiz_responses_trim.sql`, `drizzle/0021_quiz_responses_contact.sql`, `drizzle/0023_quiz_responses_source.sql` |
| Source normalizer | `src/lib/attribution.ts` (`cleanSource`) |
| QR generator | `scripts/generate-qr-codes.ts` (`npm run qr:generate`) |
| Digest email template | `src/emails/quiz-response.tsx` |
| Tests | `src/actions/quiz.test.ts` |

## Behavior & guarantees

- **Input is sanitized server-side**: free text trimmed and capped (2000 chars;
  120 for choice fields), empty strings coerced to `null`, and the rating
  clamped to an integer in `[1, 5]` (anything else → `null`).
- **The action never throws.** A DB failure returns `{ success: false }`; a
  successful save returns `{ success: true }`.
- **Best-effort digest email**: if the `QUIZ_NOTIFY_EMAIL` env var is set, each
  submission emails a digest (only the filled-in answers) to that address via
  Resend. Email failure is logged and **never** affects the save result. If the
  env var is unset, no email is attempted.

## Attribution & QR codes

Printed and shared links carry `?src=<label>` so responses can be traced back to
a placement. The label is normalized by `cleanSource` (lowercase, `a-z0-9-`,
64 chars max) before it is stored in `quiz_responses.source`; anything
unrecognizable becomes `null`. Direct visits have no source.

Codes are generated as SVG (vector, for print) and 2048px PNG into `public/qr/`,
which means they are also fetchable at `https://<host>/qr/<name>.svg`:

```bash
# Regenerate the default set — always pass --base, the generator refuses to
# guess (a QR code pointing at localhost is only discovered after printing).
npm run qr:generate -- --base https://bookuptempo.com

# One-off code for a new placement
npm run qr:generate -- --base https://bookuptempo.com --path /quiz --src chair
```

The committed set is deliberately just `flyer` for each page — exactly what's in
use — so there's no chance of sending the wrong file to a printer. Add
placements as they come up.

The generator rejects any label `cleanSource` would rewrite (e.g. `Expo 2026`),
so a printed code can never encode a label that disagrees with the stored value.

The same mechanism backs the pre-launch waitlist at `/waitlist`
(`waitlist_signups.source`).

Reporting:

```sql
SELECT source, count(*) FROM quiz_responses GROUP BY source ORDER BY count DESC;
```

## Configuration

- `QUIZ_NOTIFY_EMAIL` (optional) — internal address(es) to receive response
  digests. Accepts a **comma-separated list** for several recipients
  (`riley@example.com,emma@example.com`). Entries are trimmed, lowercased and
  deduped; malformed ones are dropped rather than failing the whole list, so one
  typo can't silence the other recipients. Leave unset to disable notifications
  (responses still persist and are queryable).
- `WAITLIST_NOTIFY_EMAIL` (optional) — same format, for `/waitlist` signups.
  Only fires for genuinely new rows, never for duplicate signups.

## Reading responses

There is no admin UI (the data is platform-level, and the app has no
super-admin surface). Query directly:

```sql
SELECT * FROM quiz_responses ORDER BY created_at DESC;
```
