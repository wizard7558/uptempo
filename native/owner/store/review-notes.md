# App Review notes — Uptempo Pro (owner app)

Paste into App Store Connect → App Review Information → Notes. Fill the
bracketed placeholders before submitting. Provide a demo login in the
"Sign-In Information" fields (required — this app is behind a login).

```
This is the staff/owner companion app for businesses that manage appointments
with Uptempo. Staff sign in to manage their business schedule, clients,
services, and payment activity.

DEMO ACCOUNT (also entered in Sign-In Information)
  Email:    [DEMO OWNER EMAIL]
  Password: [DEMO OWNER PASSWORD]
This account is an owner of a demo appointment business with sample data.

HOW TO TEST
1. Launch the app and sign in with the demo account above.
2. You land on the business dashboard (schedule). Browse Schedule, Clients,
   Services, and Settings, based on the signed-in role.
3. Optional: Settings → Calendars → "Connect Google Calendar" opens the system
   browser for Google sign-in (Google blocks OAuth inside embedded web views),
   then returns to the app.

PAYMENTS / SUBSCRIPTIONS
Platform plan and card details are read-only in the app. Plan changes and
platform payment-method updates are handled on the Uptempo website. Payment
features relate to charging clients for services delivered in person through
Stripe.

ACCOUNT DELETION
Staff can delete their account in-app: Settings → General → "Delete account".
If the user is the only owner of a business, deletion is blocked until ownership is
transferred (to avoid orphaning the business) — this is expected behavior.

NATIVE FEATURES
New-booking alerts are delivered via push notifications. Calendar connect /
Stripe payout onboarding open in the system browser and return via a custom
URL scheme.
```

## Before you submit
- Seed a demo owner account + demo appointment business with sample appointments/clients.
- Enter the demo email/password in **Sign-In Information** (Apple requires a
  working login for apps gated behind auth).
- Platform subscription changes and platform payment-method management are
  handled on the Uptempo website. Verify this read-only native presentation in
  the submitted build; this implementation does not determine App Review outcomes.
