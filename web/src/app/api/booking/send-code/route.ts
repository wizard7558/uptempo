import { getT } from "@/lib/terms/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import React from "react";
import {
  createReviewVerificationForTenant,
  createVerificationForTenant,
  normalizeBookingIdentifier,
  normalizeBookingPhone,
  readReviewOtpConfig,
} from "@/lib/booking/otp";
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
  salonId: z.string().uuid("Invalid ID").optional(),
  businessId: z.string().uuid("Invalid ID").optional(),
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

    const reviewConfig = readReviewOtpConfig();
    if (reviewConfig.email === identifier) {
      if (
        reviewConfig.status !== "valid" ||
        reviewConfig.tenantSlug !== tenantSlug
      ) {
        return NextResponse.json(
          { error: "Review access is unavailable" },
          { status: 403 },
        );
      }

      const reviewCode = await createReviewVerificationForTenant(
        tenantSlug,
        identifier,
      );
      if (!reviewCode) {
        return NextResponse.json(
          { error: "Review access is unavailable" },
          { status: 403 },
        );
      }

      // This challenge is persisted for the configured tenant and is never delivered or logged.
      return NextResponse.json({ success: true, type: "email" });
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
