import { getT } from "@/lib/terms/server";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { verifyCodeForTenant } from "@/lib/booking/otp";
import { setBookingSession } from "@/lib/booking/session-cookie";
import { findClientByEmailForTenant, findClientByPhoneForTenant, createClientForTenant } from "@/lib/clients/for-tenant";
import { getTenantSlugForSalonId } from "@/lib/tenant/registry";
import { withTenantDb } from "@/lib/db/tenant";
import { normalizePhone } from "@/lib/phone";
import { eq } from "drizzle-orm";

export const dynamic = 'force-dynamic';

const verifyCodeSchema = z.object({
  identifier: z.string().min(1, "Identifier is required"),
  code: z.string().length(6, "Code must be 6 digits"),
  salonId: z.string().uuid("Invalid ID"),
  name: z.string().optional(),
  phone: z.string().min(1).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = verifyCodeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const { identifier, code, name, salonId, phone } = parsed.data;
    const tenantSlug = await getTenantSlugForSalonId(salonId);
    if (!tenantSlug) {
      return NextResponse.json(
        { error: (await getT("errors"))("bookingApi.placeNotFound") },
        { status: 404 },
      );
    }

    // Verify the OTP code
    const result = await verifyCodeForTenant(tenantSlug, identifier, code);
    if (!result.valid) {
      return NextResponse.json(
        { error: "Invalid or expired code" },
        { status: 400 },
      );
    }

    // Determine type from identifier
    const type: "email" | "phone" = identifier.includes("@")
      ? "email"
      : "phone";

    // Enforce the salon's online-booking audience (new vs existing clients).
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
      const existing = await findClientByEmailForTenant(tenantSlug, identifier);
      if (existing) {
        clientId = existing.id;
        clientName = existing.name;
        isReturning = true;
        // Save the phone provided at sign-in so reminders/iMessage can reach them.
        const normalizedPhone = normalizePhone(phone);
        if (normalizedPhone) {
          await withTenantDb(tenantSlug, async (db, { clients }) => {
            await db
              .update(clients)
              .set({ phone: normalizedPhone, updatedAt: new Date() })
              .where(eq(clients.id, existing.id));
          });
        }
      } else {
        const created = await createClientForTenant(tenantSlug, {
          name: name || "Guest",
          email: identifier,
          phone: phone ?? null,
        });
        if (created.success) {
          clientId = created.id;
          clientName = name || "Guest";
        } else if (phone) {
          // The supplied phone may already belong to an existing client (e.g. a
          // returning customer who originally booked by phone). Log them into
          // that record — and attach this verified email — instead of failing.
          const byPhone = await findClientByPhoneForTenant(tenantSlug, phone);
          if (!byPhone) {
            return NextResponse.json(
              { error: "Failed to create client" },
              { status: 500 },
            );
          }
          clientId = byPhone.id;
          clientName = byPhone.name;
          isReturning = true;
          if (!byPhone.email) {
            await withTenantDb(tenantSlug, async (db, { clients }) => {
              await db
                .update(clients)
                .set({ email: identifier, updatedAt: new Date() })
                .where(eq(clients.id, byPhone.id));
            });
          }
        } else {
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

    // Remember the salon (readable client-side) so the native app's tab bar
    // and cold-start redirect are salon-scoped from the very first sign-in.
    const cookieStore = await cookies();
    cookieStore.set("uptempo_last_salon", tenantSlug, {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 365 * 24 * 60 * 60,
    });

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
