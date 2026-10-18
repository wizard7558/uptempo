import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth/server";
import { publicDb } from "@/lib/db";
import { user } from "@/lib/db/schema/auth";
import {
  getBookingSession,
  setBookingSession,
} from "@/lib/booking/session-cookie";
import { getTenantSlugForBookingClient } from "@/lib/tenant/registry";
import { withTenantDb } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

type Principal = {
  ownerType: "client" | "user";
  ownerId: string;
  tenantSlug: string;
};

/**
 * Resolve who is registering: an authenticated owner/staff user (Better Auth)
 * or a booking client (signed cookie). Owner session takes precedence.
 */
async function resolvePrincipal(): Promise<Principal | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session?.user?.id) {
    const [row] = await publicDb
      .select({ tenantSlug: user.tenantSlug })
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1);
    if (row?.tenantSlug) {
      return {
        ownerType: "user",
        ownerId: session.user.id,
        tenantSlug: row.tenantSlug,
      };
    }
  }

  const clientId = await getBookingSession();
  if (clientId) {
    const tenantSlug = await getTenantSlugForBookingClient(clientId);
    if (tenantSlug) {
      return { ownerType: "client", ownerId: clientId, tenantSlug };
    }
  }

  return null;
}

function validToken(value: unknown): value is string {
  // APNs device tokens are hex strings (historically 64 chars, longer now).
  return typeof value === "string" && /^[0-9a-fA-F]{32,200}$/.test(value);
}

/** Return only whether this request has a tenant-resolved app session. */
export async function GET() {
  try {
    const principal = await resolvePrincipal();
    return NextResponse.json(
      { authenticated: Boolean(principal) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { authenticated: false },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

/** Register (upsert) an APNs device token for the current principal. */
export async function POST(req: Request) {
  const principal = await resolvePrincipal();
  if (!principal) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let payload: { apnsToken?: unknown; environment?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!validToken(payload.apnsToken)) {
    return NextResponse.json({ error: "Invalid apnsToken" }, { status: 400 });
  }
  const environment =
    payload.environment === "sandbox" ? "sandbox" : "production";

  await withTenantDb(principal.tenantSlug, async (db, { deviceTokens }) => {
    await db
      .insert(deviceTokens)
      .values({
        ownerType: principal.ownerType,
        ownerId: principal.ownerId,
        apnsToken: payload.apnsToken as string,
        environment,
        revoked: 0,
      })
      .onConflictDoUpdate({
        target: deviceTokens.apnsToken,
        set: {
          ownerType: principal.ownerType,
          ownerId: principal.ownerId,
          environment,
          revoked: 0,
          lastSeenAt: new Date(),
        },
      });
  });

  // This runs on every native app launch — re-issue the booking session so
  // active clients get a sliding expiry and never have to re-verify.
  if (principal.ownerType === "client") {
    await setBookingSession(principal.ownerId);
  }

  return NextResponse.json({ success: true });
}

/** Revoke a device token (e.g. on logout or when push permission is removed). */
export async function DELETE(req: Request) {
  const principal = await resolvePrincipal();
  if (!principal) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let payload: { apnsToken?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!validToken(payload.apnsToken)) {
    return NextResponse.json({ error: "Invalid apnsToken" }, { status: 400 });
  }

  await withTenantDb(principal.tenantSlug, async (db, { deviceTokens }) => {
    await db
      .update(deviceTokens)
      .set({ revoked: 1, lastSeenAt: new Date() })
      .where(eq(deviceTokens.apnsToken, payload.apnsToken as string));
  });

  return NextResponse.json({ success: true });
}
