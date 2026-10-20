# App Review notes — Uptempo (client app)

Paste into App Store Connect → App Review Information → Notes. Fill the
bracketed placeholders before submitting.

```
This is the customer app for appointment-based businesses using Uptempo.
Customers discover participating businesses, explore services, and manage
their appointments. Available businesses and services depend on each business.

HOW TO TEST
1. On launch the app opens the appointment-business directory.
2. Search for the demo business: "[DEMO BUSINESS NAME]" and tap it.
3. Choose a service and provider, pick a time, and proceed to book.
4. Sign-in uses a one-time code sent by email/SMS. For review, use:
   - Email: [DEMO CLIENT EMAIL — must equal the REVIEW_OTP_EMAIL env var]
   - The verification code is: [REVIEW_OTP_CODE — 6 digits]
   (A static review code is enabled for this one account so review does not
   require access to a real inbox/phone.)
5. After booking you can view, reschedule, or cancel under "My Account".

PAYMENTS
Payments in the app are for services delivered in person and are processed
through Stripe. The app does not sell digital content.

ACCOUNT DELETION
Users can delete their account in-app: My Account → Profile → "Delete my
account". This cancels any membership, removes saved payment data, and erases
personal details.

NATIVE FEATURES
Appointment reminders are delivered via push notifications. Booking links open
the app via Universal Links.
```

## Before you submit — set up the demo
- Create/seed a demo business listed in the marketplace (owner app → General
  Settings → "App marketplace" toggle ON) and note its name.
- Provide a working demo client login. Login is OTP-based and reviewers cannot
  receive our SMS/email, so set in Vercel env (production):
  `REVIEW_OTP_EMAIL=<demo client email>` and `REVIEW_OTP_CODE=<6 digits>`.
  That one identifier then verifies with the static code (`src/lib/booking/otp.ts`);
  every other account is unaffected. Remove the vars after review if desired.
```
