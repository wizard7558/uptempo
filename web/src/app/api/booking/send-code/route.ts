import { getT } from "@/lib/terms/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import React from "react";
import { createVerificationForTenant } from "@/lib/booking/otp";
import { sendEmail } from "@/lib/email/send";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import { clientIpFrom } from "@/lib/http/client-ip";
import { getTenantSlugForBusinessId } from "@/lib/tenant/registry";
import { getSmsProvider } from "@/lib/providers/sms";
import { isLoopMessageConfigured } from "@/lib/sms/loopmessage";

export const dynamic = 'force-dynamic';

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_REQUESTS_PER_IDENTIFIER = 3;
const MAX_REQUESTS_PER_IP = 5;

const sendCodeSchema = z.object({
  identifier: z.string().min(1, "Identifier is required"),
  phone: z.string().min(1).optional(),
  salonId: z.string().uuid("Invalid ID"),
});

/** Send the verification code to a phone via iMessage (when LoopMessage is the
 * active provider). Best-effort; failures don't block the email delivery. */
async function sendCodeToPhone(
  tenantSlug: string,
  phone: string,
  code: string,
): Promise<void> {
  const provider = getSmsProvider();
  if (provider.id !== "loopmessage") return; // SMS shelved; only iMessage for now
  const result = await provider.send({
    to: phone,
    body: `Your Uptempo booking code is: ${code}`,
    passthrough: tenantSlug,
  });
  if (!isLoopMessageConfigured()) {
    console.log(`[DEV] verification code for ${phone}: ${code}`);
  } else if (!result.success) {
    console.error(
      `[send-code] iMessage code send failed for ${phone}: ${result.error}`,
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = sendCodeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const { identifier, salonId, phone } = parsed.data;
    const tenantSlug = await getTenantSlugForBusinessId(salonId);
    if (!tenantSlug) {
      return NextResponse.json(
        { error: (await getT("errors"))("bookingApi.placeNotFound") },
        { status: 404 },
      );
    }

    // Detect type: email or phone
    const type: "email" | "phone" = identifier.includes("@")
      ? "email"
      : "phone";

    // Rate limiting by identifier
    const identifierLimit = await consumeRateLimit({
      tenantSlug,
      scope: "identifier",
      key: identifier,
      limit: MAX_REQUESTS_PER_IDENTIFIER,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });
    if (!identifierLimit.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 },
      );
    }

    // Rate limiting by IP
    const ip = clientIpFrom(req.headers);
    const ipLimit = await consumeRateLimit({
      tenantSlug,
      scope: "ip",
      key: ip,
      limit: MAX_REQUESTS_PER_IP,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 },
      );
    }

    // Generate and store verification code
    const code = await createVerificationForTenant(tenantSlug, identifier, type);

    // Send the code to every channel we have: email always, plus iMessage to
    // the phone when one was provided at sign-in.
    if (type === "email") {
      await sendEmail({
        to: identifier,
        subject: "Your booking verification code",
        react: React.createElement("div", null,
          React.createElement("p", null, `Your verification code is: ${code}`),
          React.createElement("p", null, "This code expires in 10 minutes."),
        ),
      });
      if (phone) {
        await sendCodeToPhone(tenantSlug, phone, code);
      }
    } else {
      const provider = getSmsProvider();
      if (!provider.enabled || provider.id === "none") {
        if (process.env.NODE_ENV !== "production") {
          console.log(`[DEV] SMS verification code for ${identifier}: ${code}`);
        }
      } else if (provider.id === "loopmessage") {
        // Phone: send the code via iMessage (LoopMessage). Active text channel
        // while SMS is shelved. No email fallback here — a phone-only identifier
        // has no email on file.
        const result = await provider.send({
          to: identifier,
          body: `Your Uptempo booking code is: ${code}`,
          passthrough: tenantSlug,
        });
        if (!isLoopMessageConfigured()) {
          console.log(`[DEV] verification code for ${identifier}: ${code}`);
        } else if (!result.success) {
          console.error(
            `[send-code] iMessage code send failed for ${identifier}: ${result.error}`,
          );
        }
      } else {
        const result = await provider.send({
          to: identifier,
          body: `Your Uptempo booking code is: ${code}`,
        });
        if (!result.success) {
          throw new Error(result.error ?? "Failed to send SMS");
        }
      }
    }

    return NextResponse.json({ success: true, type });
  } catch (error) {
    console.error("Error sending verification code:", error);
    return NextResponse.json(
      { error: "Failed to send verification code" },
      { status: 500 },
    );
  }
}
