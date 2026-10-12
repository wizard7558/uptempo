# Uptempo native iOS apps (Capacitor)

Two thin Capacitor shells that wrap the live Next.js site (`bookuptempo.com`) in
**remote-URL mode** and add the native capabilities Apple requires. The web app
is unchanged — feature parity is automatic.

| App | Dir | Bundle ID | Opens |
|-----|-----|-----------|-------|
| Uptempo Pro (owner/staff) | `owner/` | `com.uptempo.owner` | `/login → /admin` |
| Uptempo (clients) | `client/` | `com.uptempo.client` | `/discover → /book/:slug` |

**Surface mapping** (the directory names predate the product names, so note the
split): `native/owner` ships as **Uptempo Pro** (`com.uptempo.owner`) — the
professional dashboard — and `native/client` ships as **Uptempo**
(`com.uptempo.client`) — the client booking experience (Uptempo).

These projects intentionally live **outside** `web/` so Vercel never
traces iOS build artifacts (the Next build pins `outputFileTracingRoot` to the
app dir).

## One-time setup per app

The native `ios/` projects are **already generated and committed** (Capacitor 8,
Swift Package Manager — no CocoaPods needed). Icons/splash are generated, and
bundle IDs, URL schemes, push forwarding (AppDelegate), entitlements
(`aps-environment` + `applinks:bookuptempo.com` and `applinks:www.bookuptempo.com`), and
`ITSAppUsesNonExemptEncryption` are pre-configured. The Capacitor CLI requires
Node >= 22.

```bash
cd owner   # or client
npm install              # restores node_modules the SPM package references
npx cap sync ios
npx cap open ios         # opens Xcode
```

## Xcode configuration (both apps)

Only signing remains (needs the Apple Developer account):

1. In Signing & Capabilities, select your **Team** (automatic signing). Xcode
   registers the App ID and enables Push Notifications + Associated Domains
   from the committed `App.entitlements`.
2. Verify the capabilities list shows **Push Notifications** and
   **Associated Domains** (`applinks:bookuptempo.com` and `applinks:www.bookuptempo.com`); add them manually if
   automatic signing didn't pick them up.

The backend already serves the matching AASA at
`https://bookuptempo.com/.well-known/apple-app-site-association` — set the env
vars `APPLE_APP_ID_OWNER` / `APPLE_APP_ID_CLIENT` (format `TEAMID.bundleId`) so
the file lists your real Team ID.

## APNs (push) backend

Create an APNs Auth Key (.p8) in the Apple Developer portal and set these in
Vercel env (used by `src/lib/push/apns.ts`):

```
APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY (the .p8 PEM),
APNS_BUNDLE_ID_OWNER=com.uptempo.owner,
APNS_BUNDLE_ID_CLIENT=com.uptempo.client
```

The web app registers the device token automatically on launch
(`src/components/native/native-bridge.tsx` → `POST /api/push/register`). Debug
(sandbox) builds should set `window.__APNS_ENV__ = "sandbox"`.

## Icons & splash screens

Source assets live in each app's `assets/` (already generated, App Store-safe —
1024×1024 icon, no alpha): client = ivory mark on ink, owner = ink mark on ivory
(so the two listings are visually distinct). After `cap add ios`, generate
the full iOS icon/splash set into the native project:

```bash
cd owner   # or client
npm install
npm run assets    # capacitor-assets generate --ios (reads assets/icon.png + splash*.png)
npx cap sync ios
```

Re-run `npm run assets` whenever you change the source art in `assets/`.

## App Store metadata

Per-app listing copy and review notes are in `store/`:
- `store/listing.md` — name, subtitle, description, keywords, categories, privacy labels
- `store/review-notes.md` — the App Review notes + demo-account setup checklist

Fill the `[BRACKETED]` placeholders (demo accounts, salon name) before submitting.

For the client app's OTP login, set `REVIEW_OTP_EMAIL` + `REVIEW_OTP_CODE`
(6 digits) in Vercel env — that one demo identifier then verifies with the
static code so Apple's reviewer never needs inbox/SMS access.

## Fastlane (build + upload)

Each app has a `fastlane/` setup using an App Store Connect **API key** (no
Apple ID password). One-time: create an API key in App Store Connect → Users and
Access → Integrations → App Store Connect API.

```bash
cd owner   # or client
bundle install
export ASC_KEY_ID=...        ASC_ISSUER_ID=...   ASC_KEY_PATH=/abs/AuthKey_XXX.p8
export APPLE_TEAM_ID=...
bundle exec fastlane beta     # build + upload to TestFlight
bundle exec fastlane release  # build + upload to App Store (manual submit)
```

Signing must be configured in Xcode first (automatic signing with your team).
Never commit the `.p8` key or env files — `.gitignore` excludes them.

## App Store review notes

- **Client app**: bookings are *physical* services → IAP-exempt; Stripe is fine.
- **Owner app**: do **not** sell subscription tiers in-app (Apple 3.1.1) — plan
  upgrades happen on the web.
- Account deletion is in-app (owner: General Settings; client: account → Profile).
- Push notifications + Universal Links + system-browser OAuth are the native
  value that carries the apps past Guideline 4.2.

See the full plan at `~/.claude/plans/let-s-make-a-plan-shimmying-meteor.md`.
