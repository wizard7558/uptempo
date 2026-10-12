# App Review notes — Uptempo Pro (owner app)

Paste into App Store Connect → App Review Information → Notes. Fill the
bracketed placeholders before submitting. Provide a demo login in the
"Sign-In Information" fields (required — this app is behind a login).

```
This is the staff/owner companion app for the Uptempo salon management platform
(a business productivity tool for existing Uptempo customers). Staff sign in to
manage their salon's schedule, clients, services, and payments.

DEMO ACCOUNT (also entered in Sign-In Information)
  Email:    [DEMO OWNER EMAIL]
  Password: [DEMO OWNER PASSWORD]
This account is an owner of a demo salon with sample data.

HOW TO TEST
1. Launch the app and sign in with the demo account above.
2. You land on the salon dashboard (schedule). Browse Schedule, Clients,
   Services, and Settings.
3. Optional: Settings → Calendars → "Connect Google Calendar" opens the system
   browser for Google sign-in (Google blocks OAuth inside embedded web views),
   then returns to the app.

PAYMENTS / SUBSCRIPTIONS
The app does NOT sell any digital content or subscriptions through the app.
Salon subscription plans are managed on the web, not in-app, so In-App Purchase
(Guideline 3.1.1) does not apply. Payment features relate to charging clients
for in-person salon services (physical services) via Stripe.

ACCOUNT DELETION
Staff can delete their account in-app: Settings → General → "Delete account".
If the user is the only owner of a salon, deletion is blocked until ownership is
transferred (to avoid orphaning the business) — this is expected behavior.

NATIVE FEATURES
New-booking alerts are delivered via push notifications. Calendar connect /
Stripe payout onboarding open in the system browser and return via a custom
URL scheme.
```

## Before you submit
- Seed a demo owner account + demo salon with sample appointments/clients.
- Enter the demo email/password in **Sign-In Information** (Apple requires a
  working login for apps gated behind auth).
- Do NOT expose any in-app purchase of subscription tiers (keep plan upgrades on
  the web) to stay clear of Guideline 3.1.1.
