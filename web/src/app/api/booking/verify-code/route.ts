import { getT } from "@/lib/terms/server";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import {
  normalizeBookingIdentifier,
  normalizeBookingPhone,
  readReviewOtpConfig,
  verifyCodeForTenant,
} from "@/lib/booking/otp";
import { setBookingSession } from "@/lib/booking/session-cookie";
import { findClientByEmailForTenant, findClientByPhoneForTenant, createClientForTenant } from "@/lib/clients/for-tenant";
import { getTenantSlugForBusinessId } from "@/lib/tenant/registry";
import { withTenantDb } from "@/lib/db/tenant";
import { normalizePhone } from "@/lib/phone";
import { eq } from "drizzle-orm";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import { clientIpFrom } from "@/lib/http/client-ip";

export const dynamic = 'force-dynamic';

const verifyCodeSchema = z.object({
  identifier: z.string().min(1, "Identifier is required"),
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
  salonId: z.string().uuid("Invalid ID").optional(),
  businessId: z.string().uuid("Invalid ID").optional(),
  name: z.string().optional(),
  phone: z.string().min(1).optional(),
}).superRefine(({ businessId, salonId }, context) => {
  if (!businessId && !salonId) {
    context.addIssue({
      code: "custom",
      message: "Invalid ID",
      path: ["businessId"],
    });
  } else if (businessId && salonId && businessId !== salonId) {
    context.addIssue({
      code: "custom",
      message: "Conflicting business IDs",
      path: ["salonId"],
    });
  }
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = verifyCodeSchema.safeParse(body);
    if (!parsed.success) {
      const invalidId = parsed.error.issues.some(
        (issue) =>
          (issue.path[0] === "businessId" || issue.path[0] === "salonId") &&
          issue.message !== "Conflicting business IDs",
      );
      return NextResponse.json(
        {
          error: invalidId
            ? "Invalid ID"
            : parsed.error.issues[0]?.message ?? "Invalid input",
        },
        { status: 400 },
      );
    }

    const { code, name } = parsed.data;
    const normalized = normalizeBookingIdentifier(parsed.data.identifier);
    const phone =
      parsed.data.phone === undefined
        ? undefined
        : normalizeBookingPhone(parsed.data.phone);
    if (!normalized || (parsed.data.phone !== undefined && !phone)) {
      return NextResponse.json({ error: "Invalid identifier" }, { status: 400 });
    }
    const { identifier, type } = normalized;
    const businessId = parsed.data.businessId ?? parsed.data.salonId;
    if (!businessId) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    }
    const tenantSlug = await getTenantSlugForBusinessId(businessId);
    if (!tenantSlug) {
      return NextResponse.json(
        { error: (await getT("errors"))("bookingApi.placeNotFound") },
        { status: 404 },
      );
    }

    // Verification budgets are separate from send budgets and run before any OTP or client effects.
    const identifierLimit = await consumeRateLimit({
      tenantSlug,
      scope: "identifier",
      key: `verify:${identifier}`,
      limit: 3,
      windowMs: 10 * 60 * 1000,
    });
    if (!identifierLimit.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 },
      );
    }

    const ipLimit = await consumeRateLimit({
      tenantSlug,
      scope: "ip",
      key: `verify:${clientIpFrom(req.headers)}`,
      limit: 5,
      windowMs: 10 * 60 * 1000,
    });
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 },
      );
    }

    const reviewConfig = readReviewOtpConfig();
    const isReviewIdentity = reviewConfig.email === identifier;
    if (
      isReviewIdentity &&
      (reviewConfig.status !== "valid" ||
        reviewConfig.tenantSlug !== tenantSlug)
    ) {
      return NextResponse.json(
        { error: "Invalid or expired code" },
        { status: 400 },
      );
    }

    // Verify the OTP code against a live persisted challenge.
    const result = await verifyCodeForTenant(tenantSlug, identifier, code);
    if (!result.valid) {
      return NextResponse.json(
        { error: "Invalid or expired code" },
        { status: 400 },
      );
    }

    const reviewClient = isReviewIdentity
      ? await findClientByEmailForTenant(tenantSlug, identifier)
      : null;
    if (isReviewIdentity && !reviewClient) {
      return NextResponse.json(
        { error: "Review access is unavailable" },
        { status: 403 },
      );
    }

    // Enforce the business's online-booking audience (new vs existing clients).
    const audience = await withTenantDb(
      tenantSlug,
      async (db, { businessSettings }) => {
        const [p] = await db
          .select({ value: businessSettings.onlineBookingAudience })
          .from(businessSettings)
          .limit(1);
        return p?.value ?? "both";
      },
    );
    if (audience !== "both") {
      const preExisting =
        type === "email"
          ? await findClientByEmailForTenant(tenantSlug, identifier)
          : await findClientByPhoneForTenant(tenantSlug, identifier);
      if (audience === "existing_only" && !preExisting) {
        return NextResponse.json(
          {
            error: (await getT("errors", tenantSlug))("bookingApi.existingOnly"),
          },
          { status: 403 },
        );
      }
      if (audience === "new_only" && preExisting) {
        return NextResponse.json(
          {
            error: (await getT("errors", tenantSlug))("bookingApi.newOnly"),
          },
          { status: 403 },
        );
      }
    }

    // Find or create client
    let clientId: string;
    let clientName: string;
    let isReturning = false;

    if (type === "email") {
      const existing =
        reviewClient ?? (await findClientByEmailForTenant(tenantSlug, identifier));
      if (existing) {
        clientId = existing.id;
        clientName = existing.name;
        isReturning = true;
        // Save the phone provided at sign-in so reminders/iMessage can reach them.
        const normalizedPhone = isReviewIdentity ? null : normalizePhone(phone);
        if (normalizedPhone) {
          await withTenantDb(tenantSlug, async (db, { clients }) => {
            await db
              .update(clients)
              .set({ phone: normalizedPhone, updatedAt: new Date() })
              .where(eq(clients.id, existing.id));
          });
        }
      } else {
        if (isReviewIdentity) {
          return NextResponse.json(
            { error: "Review access is unavailable" },
            { status: 403 },
          );
        }
        const created = await createClientForTenant(tenantSlug, {
          name: name || "Guest",
          email: identifier,
          phone: phone ?? null,
        });
        if (created.success) {
          clientId = created.id;
          clientName = name || "Guest";
        } else {
          // The email OTP does not establish ownership of another client's phone record.
          return NextResponse.json(
            { error: "Failed to create client" },
            { status: 500 },
          );
        }
      }
    } else {
      const existing = await findClientByPhoneForTenant(tenantSlug, identifier);
      if (existing) {
        clientId = existing.id;
        clientName = existing.name;
        isReturning = true;
      } else {
        const created = await createClientForTenant(tenantSlug, {
          name: name || "Guest",
          phone: identifier,
        });
        if (!created.success) {
          return NextResponse.json(
            { error: "Failed to create client" },
            { status: 500 },
          );
        }
        clientId = created.id;
        clientName = name || "Guest";
      }
    }

    // Set the booking session cookie
    await setBookingSession(clientId);

    // Remember the business (readable client-side) so the native app's tab bar
    // and cold-start redirect are business-scoped from the very first sign-in.
    // Keep the legacy cookie in sync for cached native clients.
    const cookieStore = await cookies();
    const rememberedBusinessCookieOptions = {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/",
      maxAge: 365 * 24 * 60 * 60,
    };
    cookieStore.set(
      "uptempo_last_business",
      tenantSlug,
      rememberedBusinessCookieOptions,
    );
    cookieStore.set(
      "uptempo_last_salon",
      tenantSlug,
      rememberedBusinessCookieOptions,
    );

    return NextResponse.json({
      clientId,
      name: clientName,
      isReturning,
    });
  } catch (error) {
    console.error("Error verifying code:", error);
    return NextResponse.json(
      { error: "Failed to verify code" },
      { status: 500 },
    );
  }
}
