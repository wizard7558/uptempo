import { NextResponse } from "next/server";
import { isSingleMode } from "@/lib/config/mode";

/**
 * Apple App Site Association (AASA) for Universal Links.
 *
 * Served at https://<root-domain>/.well-known/apple-app-site-association with
 * Content-Type: application/json (Apple does NOT follow redirects and requires
 * this exact content type). Implemented as a route handler rather than a static
 * file in public/ so the content type is guaranteed and the App IDs can come
 * from environment variables.
 *
 * The two iOS apps share one domain, so each path is claimed by exactly one app
 * to keep Universal Link routing deterministic:
 *   - Client app  (com.uptempo.client): consumer booking surfaces
 *   - Owner app   (com.uptempo.owner):  admin / auth / onboarding surfaces
 *
 * Set these in Vercel env (format: <TEAMID>.<bundleId>), e.g. 356ZD25DP3.com.uptempo.client
 */
const CLIENT_APP_ID = process.env.APPLE_APP_ID_CLIENT ?? "TEAMID.com.uptempo.client";
const OWNER_APP_ID = process.env.APPLE_APP_ID_OWNER ?? "TEAMID.com.uptempo.owner";

const CLIENT_PATHS = [
  "/discover",
  "/book/*",
  "/subscribe/*",
  "/account",
  "/account/*",
  "/checkout/*",
  "/cancel/*",
  "/reschedule/*",
  "/intake/*",
  "/forms/*",
  "/aftercare/*",
];

const OWNER_PATHS = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/invite/*",
  "/onboarding",
  "/create-my-business",
  "/create-my-salon", // legacy: installed apps may still open this
  "/schedule",
  "/schedule/*",
  "/clients",
  "/clients/*",
  "/services",
  "/services/*",
  "/analytics",
  "/charges",
  "/revenue",
  "/expenses",
  "/settings",
  "/settings/*",
];

function detailFor(appID: string, paths: string[]) {
  return {
    appIDs: [appID],
    components: paths.map((p) => ({ "/": p, comment: `Deep link: ${p}` })),
  };
}

export function GET() {
  if (isSingleMode()) return new NextResponse(null, { status: 404 });

  const body = {
    applinks: {
      // Modern AASA: per-app "details" with "components". "apps" stays empty.
      apps: [] as string[],
      details: [
        detailFor(CLIENT_APP_ID, CLIENT_PATHS),
        detailFor(OWNER_APP_ID, OWNER_PATHS),
      ],
    },
  };

  return NextResponse.json(body, {
    headers: {
      // Long-lived but revalidatable; Apple caches AASA aggressively.
      "Cache-Control": "public, max-age=3600",
    },
  });
}
