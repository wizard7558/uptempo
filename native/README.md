# Uptempo native iOS apps (Capacitor)

Two Capacitor shells that load the hosted Next.js app in **remote-URL mode**
and provide native iOS capabilities. Most screens and booking behavior come
from the hosted web app, so native builds depend on the live site remaining
available and compatible with the bundled Capacitor plugins.

| App | Dir | Bundle ID | Opens |
|-----|-----|-----------|-------|
| Uptempo Pro (owner/staff) | `owner/` | `com.uptempo.owner` | `https://www.bookuptempo.com/login` |
| Uptempo (clients) | `client/` | `com.uptempo.client` | `https://www.bookuptempo.com/discover` |

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

Both iOS targets use a single storyboard-backed UIKit scene. `SceneDelegate`
forwards cold and warm URL and user-activity callbacks to Capacitor's
`ApplicationDelegateProxy`; `AppDelegate` continues to forward APNs registration.

```bash
cd owner   # or client
npm install              # restores node_modules the SPM package references
npx cap sync ios
npx cap open ios         # opens Xcode
```

## Xcode configuration (both apps)

For a signed build, configure:

1. In Signing & Capabilities, select your **Team** (automatic signing). Xcode
   registers the App ID and enables Push Notifications + Associated Domains
   from the committed `App.entitlements`.
2. Verify the capabilities list shows **Push Notifications** and
   **Associated Domains** (`applinks:bookuptempo.com` and `applinks:www.bookuptempo.com`); add them manually if
   automatic signing didn't pick them up.

The hosted AASA route at
`/.well-known/apple-app-site-association` remains environment-configured.
Before release, verify that direct HTTPS reads from both the apex and `www`
hosts return `application/json` without a redirect and list the App Store
Connect app IDs that match the current bundle IDs. Set `APPLE_APP_ID_OWNER` and
`APPLE_APP_ID_CLIENT` (format `TEAMID.bundleId`) through the authorized
deployment configuration; the route keeps those environment values as its
authority and uses placeholders only when they are unset. Do not infer the
Apple app record IDs from these source files.

## APNs (push) backend

Create an APNs Auth Key (.p8) in the Apple Developer portal and set these in
Vercel env (used by `src/lib/push/apns.ts`):

```
APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY (the .p8 PEM),
APNS_BUNDLE_ID_OWNER=com.uptempo.owner,
APNS_BUNDLE_ID_CLIENT=com.uptempo.client
```

The native bridge checks the existing owner or booking-client session before
asking for push permission or registering an APNs token. It retries after a
successful in-app sign-in and when the app returns to the foreground. Debug
builds inject the sandbox APNs environment and Release builds inject
production at document start for each remote page load. Token registration
uses the existing same-origin session cookie.

## Icons & splash screens

Source assets live in each app's `assets/` (already generated, App Store-safe —
1024×1024 icon, no alpha): client = white mark on ink, owner = ink mark on white
(so the two listings are visually distinct). The icons are rendered from
`web/public/brand/` by `npm run brand:build` in `web/`. After `cap add ios`, generate
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

Fill the `[BRACKETED]` placeholders (demo accounts, business name) before submitting.

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

- **Client app**: checkout is for services delivered in person and uses Stripe.
- **Owner app**: platform plan and card details are read-only in the app; plan
  changes and platform payment-method updates are handled on the Uptempo website.
- Account deletion is in-app (owner: General Settings; client: account → Profile).
- Before release, verify push notifications, Universal Links, and system-browser
  OAuth return flows on the signed device builds. These behaviors are not
  enabled by a local build alone.

See the full plan at `~/.claude/plans/let-s-make-a-plan-shimmying-meteor.md`.
