# App Store listing — Uptempo (client app)

Paste these into App Store Connect → the `com.uptempo.client` app record.

- **App name:** Uptempo
- **Subtitle (≤30 chars):** Book your salon visits
- **Primary category:** Lifestyle
- **Secondary category:** Health & Fitness
- **Age rating:** 4+
- **Support URL:** https://bookuptempo.com
- **Marketing URL:** https://bookuptempo.com
- **Privacy Policy URL:** https://bookuptempo.com/privacy

**Keywords (≤100 chars, comma-separated):**
```
salon,booking,hair,stylist,appointment,beauty,book,schedule,barber,nails,spa,haircut,color
```

**Promotional text (≤170 chars):**
```
Find your salon and book in a few taps. Manage appointments, reminders, and your details in one place.
```

**Description:**
```
Uptempo is how you find a salon and book your next appointment.

• Find your salon and browse available services and stylists
• Book in a few taps and pick the time that works for you
• Get appointment reminders so you never miss a visit
• Save your details and payment method for faster checkout
• View, reschedule, or cancel upcoming appointments
• Manage your membership and account from your phone

Uptempo connects you with the salons you love. Book the services you want, with the stylist you trust, on a schedule that fits your life.
```

**What's New (first release):**
```
First release of Uptempo. Discover salons, book appointments, and manage your visits from your phone.
```

## Screenshots needed (per current App Store requirements)
- 6.9" iPhone (e.g. 15/16 Pro Max) — required
- 6.5" iPhone — recommended
Suggested screens: discover/search, a salon's booking flow, time selection,
appointment confirmation, account/appointments list.

## App Privacy (nutrition labels) — declare accurately
Data collected and linked to the user:
- **Contact info:** name, email, phone (account + booking)
- **Financial info:** payment info (processed by Stripe; card data handled by Stripe)
- **Health & Fitness / Sensitive:** none unless services imply it — review
- **Identifiers:** user/device identifiers for push
- **Usage data / diagnostics:** analytics (PostHog/GA), crash/diagnostics
Used for: app functionality, account management. Not used for tracking across
other companies' apps (confirm before claiming "not tracking").
