import { NextResponse } from "next/server";
import {
  buildNativeReturnUrl,
  isNativeApp,
  isNativeReturnPath,
} from "@/lib/native/return";

export const dynamic = "force-dynamic";

/**
 * Bounce endpoint that hands control back to a native app via its custom URL
 * scheme. Used by flows whose external provider only accepts an https
 * return URL (e.g. Stripe Connect onboarding's return_url/refresh_url): the
 * provider returns here, and we redirect to `<scheme>://<path>`.
 *
 * Query params:
 *   - app:  "owner" | "client"            (which app's scheme)
 *   - path: one of NATIVE_RETURN_PATHS    (deep-link target)
 *   - any other params are forwarded to the deep link (whitelisted below)
 *
 * `app` and `path` are validated against allow-lists to prevent this from
 * becoming an open redirect into arbitrary URL schemes.
 */
const FORWARD_PARAMS = ["connected", "platform", "error", "stripe_setup"];

export function GET(req: Request) {
  const url = new URL(req.url);
  const app = url.searchParams.get("app");
  const path = url.searchParams.get("path");

  if (!isNativeApp(app) || !isNativeReturnPath(path)) {
    return new NextResponse("Invalid native return target", { status: 400 });
  }

  const params: Record<string, string | undefined> = {};
  for (const key of FORWARD_PARAMS) {
    const value = url.searchParams.get(key);
    if (value) params[key] = value;
  }

  const deepLink = buildNativeReturnUrl(app, path, params);

  // A custom-scheme Location works in most browsers, but some block scheme
  // redirects from a 3xx — return a tiny HTML page that also redirects via JS
  // and offers a manual fallback link.
  const safe = deepLink.replace(/"/g, "&quot;");
  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="0;url=${safe}">
<title>Returning to the app…</title></head>
<body style="font-family:-apple-system,system-ui,sans-serif;padding:2rem;text-align:center">
<p>Returning to the app…</p>
<p><a href="${safe}">Tap here if nothing happens</a></p>
<script>location.replace(${JSON.stringify(deepLink)});</script>
</body></html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
