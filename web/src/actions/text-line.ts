"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth/rbac";
import { isSingleMode } from "@/lib/config/mode";
import { publicDb } from "@/lib/db";
import { tenants, type SmsLineStatus } from "@/lib/db/schema";
import {
  reactivateRegistrationLine,
  RegistrationInput,
  resendConfirmation,
  startRegistration,
  turnOffRegistrationLine,
} from "@/lib/sms/registration";
import type { SmsRegistrationState } from "@/lib/db/schema";
import { ensureTextLineSetupFee } from "@/lib/billing/text-line-setup-fee";

type SafeRegistrationInput = {
  legalBusinessName: string;
  businessType: "SOLE_PROPRIETOR" | "PARTNERSHIP" | "LLC" | "CORPORATION";
  businessAddress: {
    street: string;
    street2?: string;
    city: string;
    state: string;
    postalCode: string;
  };
  website?: string;
  owner: {
    firstName: string;
    lastName: string;
    title: string;
    email: string;
    mobile: string;
  };
};

export type TextLineSnapshot = {
  status: SmsLineStatus;
  available: boolean;
  phoneNumber: string | null;
  mobile: string | null;
  reason: SmsRegistrationState["reason"] | null;
  reasonMessage: string | null;
  formDefaults: SafeRegistrationInput | null;
  setupFeeExempt: boolean;
  setupFeeExemptionReason: "shared" | "comped" | null;
  setupFeeAdded: boolean;
  canReactivate: boolean;
  requiresEin: boolean;
};

export type TextLineActionResult =
  | { ok: true; status: string; warning?: "billing_sync_retryable" }
  | {
      ok: false;
      error:
        | "single_mode"
        | "tenant_not_found"
        | "registration_not_configured"
        | "invalid_input"
        | "unsupported_sole_proprietor"
        | "confirmation_required"
        | "registration_in_progress"
        | "fee_unavailable"
        | "registration_unavailable"
        | "text_line_not_active"
        | "registration_not_complete"
        | "billing_sync_retryable";
    };

function safeInputFromState(
  state: SmsRegistrationState,
): SafeRegistrationInput | null {
  const input = state.input;
  if (!input) return null;
  const businessType = input.businessType;
  if (
    businessType !== "SOLE_PROPRIETOR" &&
    businessType !== "PARTNERSHIP" &&
    businessType !== "LLC" &&
    businessType !== "CORPORATION"
  ) {
    return null;
  }
  const required = [
    input.legalBusinessName,
    input.addressStreet,
    input.addressCity,
    input.addressState,
    input.addressPostalCode,
    input.ownerFirstName,
    input.ownerLastName,
    input.ownerTitle,
    input.ownerEmail,
    input.ownerMobile,
  ];
  if (required.some((value) => typeof value !== "string")) return null;
  return {
    legalBusinessName: input.legalBusinessName!,
    businessType,
    businessAddress: {
      street: input.addressStreet!,
      ...(input.addressStreet2 ? { street2: input.addressStreet2 } : {}),
      city: input.addressCity!,
      state: input.addressState!,
      postalCode: input.addressPostalCode!,
    },
    ...(input.website ? { website: input.website } : {}),
    owner: {
      firstName: input.ownerFirstName!,
      lastName: input.ownerLastName!,
      title: input.ownerTitle!,
      email: input.ownerEmail!,
      mobile: input.ownerMobile!,
    },
  };
}

async function loadTextLineTenant(slug: string) {
  const [tenant] = await publicDb
    .select({
      slug: tenants.slug,
      comped: tenants.comped,
      smsLineStatus: tenants.smsLineStatus,
      smsBrandId: tenants.smsBrandId,
      smsCampaignId: tenants.smsCampaignId,
      smsMessagingServiceSid: tenants.smsMessagingServiceSid,
      smsPhoneNumber: tenants.smsPhoneNumber,
      smsRegistration: tenants.smsRegistration,
    })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  return tenant ?? null;
}

function isSetupFeeExempt(
  status: SmsLineStatus,
  comped: number,
  state: SmsRegistrationState,
): boolean {
  return (
    comped === 1 ||
    status === "shared" ||
    state.startedFromShared === true ||
    state.setupFeeEligible === false ||
    state.setupFeeWaived === true
  );
}

function mapRegistrationError(
  error: string,
): Extract<TextLineActionResult, { ok: false }>["error"] {
  if (error === "single_mode") return "single_mode";
  if (error === "registration_not_configured")
    return "registration_not_configured";
  if (error === "registration_in_progress") return "registration_in_progress";
  if (error === "confirmation_required") return "confirmation_required";
  if (error === "text_line_not_active") return "text_line_not_active";
  if (error === "registration_not_complete") return "registration_not_complete";
  if (error === "billing_sync_retryable") return "billing_sync_retryable";
  return "registration_unavailable";
}

function revalidateTextLineSettings() {
  revalidatePath("/settings/notifications");
  revalidatePath("/settings/billing");
}

async function syncTextLineBilling(slug: string): Promise<boolean> {
  try {
    const billing = await import("@/lib/billing/subscriptions");
    await billing.syncHostedSubscription(slug);
    return true;
  } catch {
    return false;
  }
}

/** Owner-only read. The tenant slug always comes from the authenticated session. */
export async function getTextLine(): Promise<TextLineSnapshot | null> {
  const { tenantSlug } = await requireStaff("owner");
  if (isSingleMode()) return null;
  const tenant = await loadTextLineTenant(tenantSlug);
  if (!tenant) return null;

  const state = tenant.smsRegistration ?? {};
  const setupFeeExempt = isSetupFeeExempt(
    tenant.smsLineStatus,
    tenant.comped,
    state,
  );
  return {
    status: tenant.smsLineStatus,
    available: Boolean(process.env.TWILIO_PRIMARY_CUSTOMER_PROFILE_SID),
    phoneNumber: tenant.smsPhoneNumber,
    mobile: state.input?.ownerMobile ?? null,
    reason: state.reason ?? null,
    reasonMessage: state.reasonMessage ?? null,
    formDefaults: safeInputFromState(state),
    setupFeeExempt,
    setupFeeExemptionReason:
      tenant.comped === 1
        ? "comped"
        : tenant.smsLineStatus === "shared" || state.startedFromShared === true
          ? "shared"
          : null,
    setupFeeAdded: Boolean(
      state.setupFeeInvoiceItemId || state.setupFeeState === "added",
    ),
    canReactivate:
      tenant.smsLineStatus === "off" &&
      state.status === "active" &&
      Boolean(tenant.smsMessagingServiceSid && tenant.smsPhoneNumber),
    requiresEin: state.brandType === "STANDARD",
  };
}

/** Owner-only registration start and safe resubmission. EIN is used only in this request. */
export async function submitTextLine(
  raw?: unknown,
): Promise<TextLineActionResult> {
  const { tenantSlug } = await requireStaff("owner");
  if (isSingleMode()) return { ok: false, error: "single_mode" };

  const tenant = await loadTextLineTenant(tenantSlug);
  if (!tenant) return { ok: false, error: "tenant_not_found" };
  const state = tenant.smsRegistration ?? {};

  // An approved line can be turned back on without re-registration or another fee.
  if (
    raw === undefined &&
    tenant.smsLineStatus === "off" &&
    state.status === "active"
  ) {
    const activated = await reactivateRegistrationLine(tenantSlug);
    if (!activated.ok) {
      return { ok: false, error: mapRegistrationError(activated.error) };
    }
    const synced = await syncTextLineBilling(tenantSlug);
    revalidateTextLineSettings();
    return {
      ok: true,
      status: "active",
      ...(!synced ? { warning: "billing_sync_retryable" as const } : {}),
    };
  }

  if (tenant.smsLineStatus === "active") {
    return { ok: true, status: "active" };
  }
  if (tenant.smsLineStatus === "pending") {
    return { ok: true, status: "pending" };
  }
  if (
    tenant.smsLineStatus === "action_needed" &&
    state.reason === "confirm_text"
  ) {
    return { ok: false, error: "confirmation_required" };
  }

  // Validate the same contract the engine accepts before any billing operation.
  const parsed = RegistrationInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  if (!process.env.TWILIO_PRIMARY_CUSTOMER_PROFILE_SID) {
    return { ok: false, error: "registration_not_configured" };
  }
  if (
    tenant.smsLineStatus === "action_needed" &&
    state.brandType === "STANDARD" &&
    !parsed.data.ein
  ) {
    return { ok: false, error: "invalid_input" };
  }
  const brandType = parsed.data.ein ? "STANDARD" : "SOLE_PROPRIETOR";
  if (
    tenant.smsLineStatus === "action_needed" &&
    state.brandType &&
    state.brandType !== brandType
  ) {
    return { ok: false, error: "invalid_input" };
  }
  if (
    brandType === "SOLE_PROPRIETOR" &&
    (parsed.data.businessType !== "SOLE_PROPRIETOR" ||
      !parsed.data.owner.mobile.startsWith("+1"))
  ) {
    return { ok: false, error: "unsupported_sole_proprietor" };
  }

  const fee = await ensureTextLineSetupFee(tenantSlug);
  if (!fee.ok) return { ok: false, error: "fee_unavailable" };

  const result = await startRegistration(tenantSlug, parsed.data);
  if (!result.ok) {
    return { ok: false, error: mapRegistrationError(result.error) };
  }
  revalidateTextLineSettings();
  return { ok: true, status: result.status };
}

/** Owner-only resend for the sole-proprietor identity confirmation text. */
export async function resendTextLineConfirmation(): Promise<TextLineActionResult> {
  const { tenantSlug } = await requireStaff("owner");
  if (isSingleMode()) return { ok: false, error: "single_mode" };
  if (!process.env.TWILIO_PRIMARY_CUSTOMER_PROFILE_SID) {
    return { ok: false, error: "registration_not_configured" };
  }
  const result = await resendConfirmation(tenantSlug);
  if (!result.ok) {
    return { ok: false, error: mapRegistrationError(result.error) };
  }
  revalidatePath("/settings/notifications");
  return { ok: true, status: result.status };
}

/** Owner-only disable; approval SIDs and number remain saved for later reactivation. */
export async function turnOffTextLine(): Promise<TextLineActionResult> {
  const { tenantSlug } = await requireStaff("owner");
  if (isSingleMode()) return { ok: false, error: "single_mode" };

  const result = await turnOffRegistrationLine(tenantSlug);
  if (!result.ok) {
    return { ok: false, error: mapRegistrationError(result.error) };
  }
  const synced = await syncTextLineBilling(tenantSlug);
  revalidateTextLineSettings();
  return {
    ok: true,
    status: "off",
    ...(!synced ? { warning: "billing_sync_retryable" as const } : {}),
  };
}
