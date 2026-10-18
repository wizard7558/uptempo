# App Store listing — Uptempo (client app)

Paste these into App Store Connect → the `com.uptempo.client` app record.

- **App name:** Uptempo
- **Subtitle (≤30 chars):** Book service appointments
- **Primary category:** Lifestyle
- **Secondary category:** Health & Fitness
- **Age rating:** 4+
- **Support URL:** https://bookuptempo.com
- **Marketing URL:** https://bookuptempo.com
- **Privacy Policy URL:** https://bookuptempo.com/privacy

**Keywords (≤100 chars, comma-separated):**
```
appointment,booking,schedule,services,wellness,barber,salon,home services,training,tattoo,business
```

**Promotional text (≤170 chars):**
```
Find appointment businesses, explore services and available times, and manage bookings, reminders, and your profile in one place.
```

**Description:**
```
Uptempo helps customers find and book with appointment-based businesses.

• Discover participating businesses across personal care, wellness, training, home services, and more
• Explore services and available providers
• Choose an available time or send a booking request when the business offers that option
• Get appointment reminders
• Save your profile and payment method for faster checkout
• View, reschedule, or cancel upcoming appointments
• Review membership and account details when the business offers them

Bookings, services, and times depend on each business. Uptempo brings your appointment details together in one place.
```

**What's New:**
```
Expanded support for appointment-based businesses, with booking notifications and links that return to the right place in the app.
```

## Screenshots needed (per current App Store requirements)
- 6.9" iPhone (e.g. 15/16 Pro Max) — required
- 6.5" iPhone — recommended
Suggested screens: discover/search, a business booking flow, time selection,
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
