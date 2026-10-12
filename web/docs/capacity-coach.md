# Capacity Coach

Helps a stylist answer the question that's easy to lose track of: *"Am I working
the hours I want for the money I want?"* Each stylist sets two goals — hours per
week and target take-home per hour. A weekly job compares those goals to what
actually happened and, when someone is working hard for under their target rate,
raises a dashboard alert recommending a price increase or retiring their
lowest-yield service.

Gated to plans with the `analytics` feature (pro and above).

## How it works

1. **Goals** — set per stylist in **Settings → Stylists → Capacity Coach
   goals**: `targetHoursPerWeek` and `targetHourlyEarningsCents`. Both must be
   set for a stylist to be evaluated; clearing either opts them out.
2. **Weekly evaluation** — the `evaluate-capacity-coach` cron (Mondays 02:00
   UTC) iterates active tenants. For each goal-setting stylist it looks at the
   trailing **28 days** of *completed* appointments and computes:
   - average actual hours worked per week (booked service minutes ÷ 60 ÷ 4),
   - effective hourly earnings (service revenue ÷ booked hours),
   - the lowest-yield service by revenue-per-minute.
3. **Alert** — if the stylist is earning under their target rate (beyond a 5%
   grace band), an alert is upserted with a recommendation. Severity is
   **warning** when they're *also* over their target hours, otherwise **info**.
   If they're back on track, the prior alert is cleared.
4. **Surface** — alerts appear in the bell menu in the admin header (unread
   badge, dismissible). Re-evaluation each week resurfaces an alert that's still
   valid.

## Scoring rules (`computeCapacityInsight`)

The scoring is a pure function (`src/lib/services/capacity-coach.ts`),
unit-tested exhaustively. It returns **no alert** when:

- either goal is unset / non-positive, or there's no booked time in the window;
- the effective hourly rate is at or above `target × (1 − 5%)` (on track).

When it does flag:

- `suggestedIncreasePct` = the bump needed to reach the target rate, clamped to
  **1–40%** so the recommendation stays credible.
- `worstService` = the lowest revenue-per-minute service that is *below* the
  target rate/minute (so already-strong services aren't suggested for cuts). If
  none qualifies, the copy falls back to a generic "raise prices" suggestion.

Revenue is sourced from `appointment_services.price_charged_cents` (falling back
to the service catalog price) so cash-paid appointments — which don't create a
Stripe `charge` — are still counted.

## Data model

| Concern | Location |
| --- | --- |
| Stylist goals | tenant `stylists.target_hours_per_week`, `.target_hourly_earnings_cents` |
| Alerts | tenant `alerts` table (generic; `type = "capacity_coach"`) |
| Migration | `src/lib/tenant/migrations/0034-capacity-coach.ts` |
| Scoring + evaluator | `src/lib/services/capacity-coach.ts` |
| Cron route | `src/app/api/cron/evaluate-capacity-coach/route.ts` (+ `vercel.json`) |
| Alert actions | `src/actions/alerts.ts` |
| Goals action | `src/actions/stylists.ts` → `updateStylistGoals` |
| Bell UI | `src/components/layout/alerts-bell.tsx` (mounted in `(admin)/layout.tsx`) |
| Goals editor | `src/components/settings/capacity-goals-card.tsx` |
| Tests | `src/lib/services/capacity-coach.test.ts` |

## The `alerts` table

A generic in-app notification store (not the SMS/email *settings* in
`src/actions/notifications.ts`). `dedupe_key` makes evaluation idempotent — a
coach alert is keyed `capacity_coach:<stylistId>`, so re-runs upsert in place
rather than piling up. `data` holds the structured `CapacityInsight` payload.
`read_at` / `dismissed_at` drive the bell's unread badge and dismissal.

## Operations

- **Schedule**: `0 2 * * 1` in `vercel.json`.
- **Auth**: `CRON_SECRET` bearer token (same as the other crons — already
  configured in production).
- **Manual run**: `curl -H "Authorization: Bearer $CRON_SECRET" \
  https://<host>/api/cron/evaluate-capacity-coach`. The JSON response reports
  `evaluated`, `skipped`, `alertsUpserted`, and `alertsCleared` per run.
- One tenant failing is logged and never blocks the others.
