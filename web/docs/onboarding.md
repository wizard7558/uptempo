# Salon Onboarding

New salon owners walk a guided wizard covering every setting that matters
before their portal opens. The admin portal is **gated** until launch; salons
that launched before gating existed are grandfathered automatically.

## The wizard (`/onboarding`)

Seven steps (six for email signups — Profile is OAuth-only):

| # | Step | What happens | Completion |
| - | --- | --- | --- |
| 0 | Profile | OAuth users name the salon, pick slug + timezone | tenant exists |
| 1 | Services | Seed from templates (≥1 required — the old "add later" skip is gone) | derived: count > 0 |
| 2 | Hours | Weekly hours (embedded settings client) | `completeHoursStep()` — server-verifies rows exist |
| 3 | Policies | Plain-language review of cancellation/no-show/card-on-file + full form | explicit `policies` flag |
| 4 | Payments | Connect Stripe (hosted flow returns to the wizard) **or** skip explicitly | derived `stripe` OR explicit `stripeSkipped` |
| 5 | Branding | Logo + colors (embedded settings client), skippable | explicit `branding` (optional) |
| 6 | Review & Launch | Summary, booking link, launch checklist | `launchSalon()` |

## The card-on-file trap (closed)

`salon_policies.require_card_on_file` defaults to **on**, but a salon without
Stripe Connect can't process cards — historically a salon could launch with a
public booking flow demanding cards it couldn't charge. Now:

- **Skipping Stripe** (`skipStripeForNow()`) flips card-on-file **off** when it
  was on, tells the owner why, and records `stripeSkipped`.
- After they connect Stripe later, **Settings → Billing** shows a one-click
  "require card on file again?" prompt (only for salons that skipped).
- Launch is never blocked on Stripe itself (KYC can take days) — but the owner
  must make an explicit connect-or-skip **choice**.

## Portal gate

`src/app/(admin)/layout.tsx` (after `requireAdminRole()`):
`resolveOnboardingRedirect(state, role)` (`src/lib/onboarding/gate.ts`, pure +
tested) sends un-launched owners/admins to `/onboarding` and staff to
`/onboarding/pending`. Launched (or unknown) state → no redirect, so **every
existing live salon is unaffected**. The state read shares the sidebar loader's
`unstable_cache` entry (60s TTL, tag-invalidated by every flag write and by
`setupConnectAccount`), so the gate adds no DB load and never bounces a
just-launched owner. Multi-salon owners gated into a new salon's wizard get a
switch-back control in the onboarding layout.

## Launch validation

`launchSalon()` validates **fresh** (uncached): owner/admin role, services > 0,
hours > 0, `policies` reviewed, payments choice made. On failure it returns
`missing: ("services"|"hours"|"policies"|"payments")[]` and the wizard jumps to
the first missing step. (Previously: no validation and no role check — any
member could launch.)

## State

`tenants.onboarding_steps` (jsonb, public table — no tenant migration).
Shared shape in `src/lib/onboarding/state.ts` (`OnboardingState`):
`profile, services, hours` + new `policies, stripeSkipped, branding` +
`stripe, launched`. Reads default missing keys to false (legacy tenants merge
forward lazily); writes spread-merge and preserve unknown keys. Explicit flags
go through the allowlist in `markOnboardingStepComplete`
(`hours | policies | branding` — `launched`/`stripeSkipped` have dedicated,
role-checked actions).

## Post-launch checklist

The sidebar card is now post-launch only ("Finish setup": Stripe, branding) and
renders solely for salons that skipped Stripe during the new flow — existing
live salons see no new UI.

## Tests

`src/lib/onboarding/state.test.ts` (back-compat merge, prereq matrix, gate per
role) and `src/actions/onboarding.test.ts` (launch validation incl. each
missing prereq + role rejection, skip-Stripe card-on-file behavior, jsonb
unknown-key preservation).
