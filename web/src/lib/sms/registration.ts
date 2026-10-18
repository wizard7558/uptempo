import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { publicDb } from "@/lib/db";
import { tenants, type SmsRegistrationState } from "@/lib/db/schema";
import { isSingleMode } from "@/lib/config/mode";
import { tenantPublicBaseUrl } from "@/lib/booking/public-url";
import { getNotificationSettingsForTenant } from "@/lib/notifications/settings";
import {
  DEFAULT_SMS_CONFIRMATION_TEMPLATE,
  renderSmsTemplate,
} from "@/lib/sms/template";
import { createFakeRegistrationClient } from "./fake-registration-client";
import { RegistrationAdapterError } from "@/lib/sms/registration-errors";

const US_STATES = new Set(
  "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(
    " ",
  ),
);
const addressSchema = z.object({
  street: z.string().trim().min(2).max(100),
  street2: z.string().trim().max(100).optional(),
  city: z.string().trim().min(2).max(80),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .refine((value) => US_STATES.has(value)),
  postalCode: z
    .string()
    .trim()
    .regex(/^\d{5}(?:-\d{4})?$/),
});

export const RegistrationInput = z.object({
  legalBusinessName: z.string().trim().min(2).max(120),
  ein: z
    .string()
    .trim()
    .regex(/^\d{2}-?\d{7}$/)
    .optional(),
  businessType: z.enum([
    "SOLE_PROPRIETOR",
    "PARTNERSHIP",
    "LLC",
    "CORPORATION",
  ]),
  businessAddress: addressSchema,
  website: z
    .string()
    .url()
    .refine((value) => ["http:", "https:"].includes(new URL(value).protocol))
    .optional(),
  owner: z.object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    title: z.string().trim().min(1).max(80),
    email: z.string().trim().email().max(254),
    mobile: z
      .string()
      .trim()
      .regex(/^\+[1-9]\d{7,14}$/),
  }),
});

export type RegistrationInput = z.input<typeof RegistrationInput>;
type ParsedInput = z.output<typeof RegistrationInput>;
type Attributes = Record<string, string | number | boolean>;

/** Uptempo industry identifiers map to Twilio-supported business_industry codes. */
export const TWILIO_INDUSTRY_BY_UPTEMPO: Readonly<Record<string, string>> = {
  hair_salon: "CONSUMER",
  barber: "CONSUMER",
  barbershop: "CONSUMER",
  nail_salon: "CONSUMER",
  tattoo: "CONSUMER",
  massage_wellness: "HEALTHCARE",
  personal_training: "HEALTHCARE",
  home_services: "PROFESSIONAL",
  general: "OTHER",
};
export const twilioIndustryFor = (industry: string): string =>
  TWILIO_INDUSTRY_BY_UPTEMPO[industry] ?? "OTHER";

export interface RegistrationResource {
  sid: string;
}
export interface RegistrationStatus {
  status: string;
  identityStatus?: string;
  reasonCode?:
    | "domain_ownership"
    | "undeliverable_email"
    | "invalid_business_email"
    | "opt_in_flow";
}

/**
 * Each mutating method performs at most one create/update. The engine stores
 * its returned SID before calling the next method.
 */
export interface RegistrationClient {
  createBusinessInformation(input: {
    friendlyName: string;
    attributes: Attributes;
  }): Promise<RegistrationResource>;
  updateBusinessInformation(sid: string, attributes: Attributes): Promise<void>;
  createProfile(input: {
    friendlyName: string;
    email: string;
    policySid: string;
  }): Promise<RegistrationResource>;
  createRepresentative(input: {
    friendlyName: string;
    attributes: Attributes;
  }): Promise<RegistrationResource>;
  updateRepresentative(sid: string, attributes: Attributes): Promise<void>;
  createAddress(input: {
    friendlyName: string;
    businessName: string;
    address: ParsedInput["businessAddress"];
  }): Promise<RegistrationResource>;
  updateAddress(
    sid: string,
    businessName: string,
    address: ParsedInput["businessAddress"],
  ): Promise<void>;
  createAddressDocument(input: {
    friendlyName: string;
    addressSid: string;
  }): Promise<RegistrationResource>;
  updateAddressDocument(sid: string, addressSid: string): Promise<void>;
  createA2PProfileInformation(input: {
    friendlyName: string;
  }): Promise<RegistrationResource>;
  updateA2PProfileInformation(sid: string): Promise<void>;
  createStarterInformation(input: {
    friendlyName: string;
    attributes: Attributes;
  }): Promise<RegistrationResource>;
  createSoleProprietorInformation(input: {
    friendlyName: string;
    attributes: Attributes;
  }): Promise<RegistrationResource>;
  updateStarterInformation(sid: string, attributes: Attributes): Promise<void>;
  updateSoleProprietorInformation(
    sid: string,
    attributes: Attributes,
  ): Promise<void>;
  assignProfile(
    profileSid: string,
    objectSid: string,
  ): Promise<RegistrationResource>;
  assignProfileToPrimary(
    primarySid: string,
    profileSid: string,
  ): Promise<RegistrationResource>;
  assignPrimaryToStarter(
    starterSid: string,
    primarySid: string,
  ): Promise<RegistrationResource>;
  assignTrustProduct(
    trustProductSid: string,
    objectSid: string,
  ): Promise<RegistrationResource>;
  evaluateProfile(
    profileSid: string,
    policySid: string,
  ): Promise<{ sid: string; compliant: boolean }>;
  submitProfile(profileSid: string): Promise<void>;
  createTrustProduct(input: {
    friendlyName: string;
    email: string;
    policySid: string;
  }): Promise<RegistrationResource>;
  evaluateTrustProduct(
    trustProductSid: string,
    policySid: string,
  ): Promise<{ sid: string; compliant: boolean }>;
  submitTrustProduct(trustProductSid: string): Promise<void>;
  createBrand(input: {
    brandType: "STANDARD" | "SOLE_PROPRIETOR";
    customerProfileSid: string;
    trustProductSid: string;
  }): Promise<RegistrationResource>;
  updateBrand(brandSid: string): Promise<void>;
  fetchBrand(brandSid: string): Promise<RegistrationStatus>;
  createMessagingService(input: {
    friendlyName: string;
    inboundRequestUrl: string;
    statusCallback: string;
  }): Promise<RegistrationResource>;
  createCampaign(input: {
    messagingServiceSid: string;
    brandSid: string;
    usecase: "LOW_VOLUME" | "SOLE_PROPRIETOR";
    description: string;
    messageFlow: string;
    messageSamples: string[];
  }): Promise<RegistrationResource>;
  updateCampaign(input: {
    messagingServiceSid: string;
    campaignSid: string;
    brandSid: string;
    usecase: "LOW_VOLUME" | "SOLE_PROPRIETOR";
    description: string;
    messageFlow: string;
    messageSamples: string[];
  }): Promise<void>;
  fetchCampaign(
    messagingServiceSid: string,
    campaignSid: string,
  ): Promise<RegistrationStatus>;
  findLocalNumber(input: {
    areaCode: string;
    region: string;
  }): Promise<{ phoneNumber: string } | null>;
  purchaseNumber(input: {
    phoneNumber: string;
    friendlyName: string;
    inboundRequestUrl: string;
    statusCallback: string;
  }): Promise<RegistrationResource & { phoneNumber: string }>;
  attachNumber(
    messagingServiceSid: string,
    phoneNumberSid: string,
    phoneNumber: string,
    friendlyName: string,
  ): Promise<RegistrationResource>;
  resendBrandOtp(brandSid: string): Promise<void>;
}

export type RegistrationClientFactory = () => RegistrationClient;
let registrationClientFactory: RegistrationClientFactory | null = null;
/** Test seam; passing null restores the production Twilio adapter. */
export function setRegistrationClientFactoryForTests(
  factory: RegistrationClientFactory | null,
): void {
  registrationClientFactory = factory;
}
async function getRegistrationClient(): Promise<RegistrationClient> {
  if (registrationClientFactory) return registrationClientFactory();
  if (process.env.SMS_PROVIDER?.trim().toLowerCase() === "log") {
    // The dev/log transport must never cause Trust Hub or Messaging API calls.
    return createFakeRegistrationClient();
  }
  const adapter = await import("./twilio-registration-client");
  return adapter.createTwilioRegistrationClient();
}

const SECONDARY_PROFILE_POLICY = "RNdfbf3fae0e1107f8aded0e7cead80bf5";
const A2P_TRUST_PRODUCT_POLICY = "RNb0d4771c2c98518d916a3d4cd70a8f8b";
const SOLE_PROFILE_POLICY = "RN806dd6cd175f314e1f96a9727ee271f4";
const SOLE_TRUST_POLICY = "RN670d5d2e282a6130ae063b234b6019c8";
const REGISTRATION_EMAIL = "support@bookuptempo.com";
// Bounded adapter operations settle inside the lease before another worker can claim the row.
const LEASE_MS = 90_000;

function safeInput(
  input: ParsedInput,
  website: string,
): Record<string, string> {
  const address = input.businessAddress;
  return {
    legalBusinessName: input.legalBusinessName,
    businessType: input.businessType,
    addressStreet: address.street,
    ...(address.street2 ? { addressStreet2: address.street2 } : {}),
    addressCity: address.city,
    addressState: address.state,
    addressPostalCode: address.postalCode,
    website,
    ownerFirstName: input.owner.firstName,
    ownerLastName: input.owner.lastName,
    ownerTitle: input.owner.title,
    ownerEmail: input.owner.email,
    ownerMobile: input.owner.mobile,
  };
}

function restoreInput(state: SmsRegistrationState): ParsedInput | null {
  const input = state.input;
  if (!input) return null;
  const parsed = RegistrationInput.safeParse({
    legalBusinessName: input.legalBusinessName,
    businessType: input.businessType,
    businessAddress: {
      street: input.addressStreet,
      street2: input.addressStreet2,
      city: input.addressCity,
      state: input.addressState,
      postalCode: input.addressPostalCode,
    },
    website: input.website,
    owner: {
      firstName: input.ownerFirstName,
      lastName: input.ownerLastName,
      title: input.ownerTitle,
      email: input.ownerEmail,
      mobile: input.ownerMobile,
    },
  });
  return parsed.success ? parsed.data : null;
}

function businessAttributes(
  input: ParsedInput,
  industry: string,
  ein: string,
): Attributes {
  const types: Record<ParsedInput["businessType"], string> = {
    SOLE_PROPRIETOR: "Sole Proprietorship",
    PARTNERSHIP: "Partnership",
    LLC: "Limited Liability Corporation",
    CORPORATION: "Corporation",
  };
  return {
    business_identity: "direct_customer",
    business_industry: twilioIndustryFor(industry),
    business_name: input.legalBusinessName,
    business_regions_of_operation: "USA_AND_CANADA",
    business_registration_identifier: "EIN",
    business_registration_number: ein,
    business_type: types[input.businessType],
    website_url: input.website ?? "",
  };
}

function representativeAttributes(input: ParsedInput): Attributes {
  const { owner } = input;
  const positions = new Set([
    "Director",
    "GM",
    "VP",
    "CEO",
    "CFO",
    "General Counsel",
  ]);
  return {
    first_name: owner.firstName,
    last_name: owner.lastName,
    email: owner.email,
    phone_number: owner.mobile,
    business_title: owner.title,
    job_position: positions.has(owner.title) ? owner.title : "Other",
  };
}

function starterInformationAttributes(input: ParsedInput): Attributes {
  return {
    email: input.owner.email,
    first_name: input.owner.firstName,
    last_name: input.owner.lastName,
    phone_number: input.owner.mobile,
  };
}

function soleProprietorInformationAttributes(
  input: ParsedInput,
  industry: string,
): Attributes {
  return {
    brand_name: input.legalBusinessName,
    mobile_phone_number: input.owner.mobile,
    vertical: twilioIndustryFor(industry),
  };
}

interface TenantRow {
  slug: string;
  industry: string;
  comped: number;
  smsLineStatus: "off" | "shared" | "pending" | "action_needed" | "active";
  smsBrandId: string | null;
  smsCampaignId: string | null;
  smsMessagingServiceSid: string | null;
  smsPhoneNumber: string | null;
  smsRegistration: SmsRegistrationState;
}
interface Lease {
  token: string;
}
export type RegistrationResult =
  | { ok: true; status: string; step?: string; reason?: string }
  | { ok: false; error: string; retryable?: boolean };

async function loadTenant(slug: string): Promise<TenantRow | null> {
  const [row] = await publicDb
    .select({
      slug: tenants.slug,
      industry: tenants.industry,
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
  return row ?? null;
}

function quoteSqlLiteral(value: string): string {
  return "'" + value.replaceAll("'", "''") + "'";
}
async function claim(slug: string): Promise<Lease | null> {
  const token = randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + LEASE_MS).toISOString();
  const value = JSON.stringify({ token, expiresAt });
  const [row] = await publicDb
    .update(tenants)
    .set({
      smsRegistration: sql.raw(
        "jsonb_set(coalesce(sms_registration, '{}'::jsonb), '{lease}', " +
          quoteSqlLiteral(value) +
          "::jsonb, true)",
      ),
    })
    .where(
      and(
        eq(tenants.slug, slug),
        sql.raw(
          "(sms_registration->'lease' IS NULL OR (sms_registration->'lease'->>'expiresAt')::timestamptz < " +
            quoteSqlLiteral(now) +
            "::timestamptz)",
        ),
      ),
    )
    .returning({ slug: tenants.slug });
  return row ? { token } : null;
}

async function save(
  slug: string,
  lease: Lease,
  state: SmsRegistrationState,
  update: Partial<
    Pick<
      TenantRow,
      | "smsLineStatus"
      | "smsBrandId"
      | "smsCampaignId"
      | "smsMessagingServiceSid"
      | "smsPhoneNumber"
    >
  > = {},
): Promise<void> {
  const [row] = await publicDb
    .update(tenants)
    .set({ smsRegistration: state, ...update })
    .where(
      and(
        eq(tenants.slug, slug),
        sql.raw(
          "sms_registration->'lease'->>'token' = " +
            quoteSqlLiteral(lease.token),
        ),
      ),
    )
    .returning({ slug: tenants.slug });
  if (!row) throw new Error("registration_lease_lost");
}

async function release(slug: string, lease: Lease): Promise<void> {
  await publicDb
    .update(tenants)
    .set({ smsRegistration: sql.raw("(sms_registration - 'lease')") })
    .where(
      and(
        eq(tenants.slug, slug),
        sql.raw(
          "sms_registration->'lease'->>'token' = " +
            quoteSqlLiteral(lease.token),
        ),
      ),
    );
}

async function withLease(
  slug: string,
  action: (lease: Lease, tenant: TenantRow) => Promise<RegistrationResult>,
): Promise<RegistrationResult> {
  let lease: Lease | null = null;
  try {
    lease = await claim(slug);
    if (!lease)
      return { ok: false, error: "registration_in_progress", retryable: true };
    const tenant = await loadTenant(slug);
    if (!tenant) return { ok: false, error: "tenant_not_found" };
    return await action(lease, tenant);
  } catch (error) {
    // SDK exceptions can echo request data such as the transient EIN.
    if (
      lease &&
      error instanceof RegistrationAdapterError &&
      error.code === "number_unavailable"
    ) {
      try {
        const current = await loadTenant(slug);
        if (
          current &&
          ["purchase_number", "attach_number"].includes(
            current.smsRegistration.step ?? "",
          )
        ) {
          const state = current.smsRegistration ?? {};
          const resources = { ...(state.resources ?? {}) };
          delete resources.selectedNumber;
          delete resources.phoneNumberSid;
          await save(
            slug,
            lease,
            { ...state, resources, step: "find_local_number" },
            { smsPhoneNumber: null },
          );
          return {
            ok: false,
            error: "number_selection_retryable",
            retryable: true,
          };
        }
      } catch {
        // Fall through to the generic retryable response without exposing an SDK error.
      }
    }
    return {
      ok: false,
      error: "registration_temporarily_unavailable",
      retryable: true,
    };
  } finally {
    if (lease) {
      try {
        await release(slug, lease);
      } catch {
        /* lease expiry is the recovery path */
      }
    }
  }
}

const sid = (state: SmsRegistrationState, key: string): string =>
  state.resources?.[key] ?? "";
const withResource = (
  state: SmsRegistrationState,
  key: string,
  value: string,
): SmsRegistrationState => ({
  ...state,
  resources: { ...state.resources, [key]: value },
});
async function checkpoint(
  slug: string,
  lease: Lease,
  state: SmsRegistrationState,
  step: string,
  resource?: { key: string; sid: string },
  update: Partial<
    Pick<
      TenantRow,
      | "smsLineStatus"
      | "smsBrandId"
      | "smsCampaignId"
      | "smsMessagingServiceSid"
      | "smsPhoneNumber"
    >
  > = {},
): Promise<SmsRegistrationState> {
  const next = resource
    ? withResource({ ...state, step }, resource.key, resource.sid)
    : { ...state, step };
  await save(slug, lease, next, update);
  return next;
}

function platformUrl(slug: string, path: string): string {
  return tenantPublicBaseUrl(slug) + path;
}
async function makeSamples(
  slug: string,
  businessName: string,
): Promise<{
  description: string;
  messageFlow: string;
  messageSamples: string[];
}> {
  const book = platformUrl(slug, "/book/" + encodeURIComponent(slug));
  const values = {
    client: "Jordan",
    staff: "Alex",
    date: "Monday, October 19",
    time: "2:30 PM",
    services: "appointment",
    business: businessName,
    link: platformUrl(slug, "/reschedule/sample"),
  };
  const settings = await getNotificationSettingsForTenant(slug);
  const confirmationTemplate =
    settings.smsConfirmationBody || DEFAULT_SMS_CONFIRMATION_TEMPLATE;
  const reminderTemplate =
    settings.smsReminderBody ||
    "Reminder: {services} with {staff} on {date} at {time}. To cancel/reschedule: {link}";
  const confirmation = renderSmsTemplate(confirmationTemplate, values);
  const reminder = renderSmsTemplate(reminderTemplate, values);
  return {
    description:
      businessName +
      " sends appointment confirmations and reminders to clients who book through its online booking page. Messages are transactional and are not used for marketing.",
    messageFlow:
      "Clients book at " +
      book +
      ". During booking they may select an optional SMS checkbox to consent to appointment confirmations and reminders. It is unchecked by default, and booking does not require SMS consent. Only clients with consent receive texts. Recipients may reply STOP to opt out or HELP for assistance.",
    messageSamples: [confirmation, reminder],
  };
}
function needsAction(
  state: SmsRegistrationState,
  reason: "confirm_text" | "business_rejected" | "registration_failed",
  message: string,
  resumeStep: string,
): SmsRegistrationState {
  return {
    ...state,
    status: "action_needed",
    reason,
    reasonMessage: message,
    step: resumeStep,
  };
}
function einDigits(value: string): string {
  return value.replaceAll("-", "");
}

function businessRejectionMessage(
  reasonCode?: RegistrationStatus["reasonCode"],
): string {
  switch (reasonCode) {
    case "domain_ownership":
      return "Twilio could not verify ownership of the business website domain. Confirm the website is active and follow Twilio's domain verification instructions.";
    case "undeliverable_email":
      return "Twilio could not deliver a verification email to the business contact. Confirm the contact email is valid and monitored.";
    case "invalid_business_email":
      return "Twilio requires a business contact email that matches the business domain. Update the contact email and resubmit.";
    default:
      return "Twilio could not approve the business registration. Review the business details and contact support if this continues.";
  }
}

function campaignRejectionMessage(
  reasonCode?: RegistrationStatus["reasonCode"],
): string {
  return reasonCode === "opt_in_flow"
    ? "Twilio could not verify the opt-in flow. Confirm clients actively consent before receiving texts, explain the message types, and include STOP opt-out instructions."
    : "Twilio could not approve the messaging campaign. Review the consent flow and sample messages, then contact support if this continues.";
}

/** Starts the durable workflow. Only the first Twilio request receives a full EIN. */
export async function startRegistration(
  slug: string,
  raw: RegistrationInput,
): Promise<RegistrationResult> {
  if (isSingleMode()) return { ok: false, error: "single_mode" };
  if (!process.env.TWILIO_PRIMARY_CUSTOMER_PROFILE_SID)
    return { ok: false, error: "registration_not_configured" };
  const parsed = RegistrationInput.safeParse(raw);
  if (!parsed.success)
    return { ok: false, error: "invalid_registration_input" };
  const input: ParsedInput = {
    ...parsed.data,
    website:
      parsed.data.website ??
      platformUrl(slug, "/book/" + encodeURIComponent(slug)),
  };
  const brandType = input.ein ? "STANDARD" : "SOLE_PROPRIETOR";
  if (
    brandType === "SOLE_PROPRIETOR" &&
    (input.businessType !== "SOLE_PROPRIETOR" ||
      !input.owner.mobile.startsWith("+1"))
  ) {
    return { ok: false, error: "sole_proprietor_business_type_required" };
  }
  return withLease(slug, async (lease, tenant) => {
    if (
      tenant.smsLineStatus === "active" ||
      tenant.smsLineStatus === "pending"
    ) {
      return {
        ok: true,
        status: tenant.smsLineStatus,
        step: tenant.smsRegistration.step,
      };
    }
    const old = tenant.smsRegistration ?? {};
    if (
      tenant.smsLineStatus === "action_needed" &&
      old.reason === "confirm_text"
    )
      return { ok: false, error: "confirmation_required" };
    const resubmit = tenant.smsLineStatus === "action_needed";
    if (resubmit && old.brandType === "STANDARD" && !input.ein)
      return { ok: false, error: "ein_required_for_resubmission" };
    if (resubmit && old.brandType && old.brandType !== brandType)
      return {
        ok: false,
        error: "business_type_cannot_change_on_resubmission",
      };
    const state: SmsRegistrationState = {
      ...old,
      version: 1,
      status: "collecting",
      brandType: old.brandType ?? brandType,
      input: safeInput(input, input.website!),
      einLast4: input.ein ? einDigits(input.ein).slice(-4) : undefined,
      startedFromShared:
        old.startedFromShared ?? tenant.smsLineStatus === "shared",
      setupFeeEligible:
        old.setupFeeEligible ??
        (tenant.smsLineStatus !== "shared" && tenant.comped !== 1),
      reason: undefined,
      reasonMessage: undefined,
    };
    const client = await getRegistrationClient();
    if (resubmit && old.reason === "registration_failed") {
      const next = { ...state, step: "create_campaign" };
      await save(slug, lease, next, { smsLineStatus: "pending" });
      return { ok: true, status: "pending", step: next.step };
    }
    if (resubmit) {
      const profileSid = sid(state, "customerProfileSid");
      if (!profileSid)
        return { ok: false, error: "registration_state_incomplete" };
      let nextStep = "resubmit_representative";
      if (brandType === "STANDARD") {
        const businessInformationSid = sid(state, "businessInformationSid");
        if (!businessInformationSid || !input.ein)
          return { ok: false, error: "registration_state_incomplete" };
        // A corrected EIN is sent only in this synchronous request and never saved.
        await client.updateBusinessInformation(
          businessInformationSid,
          businessAttributes(input, tenant.industry, einDigits(input.ein)),
        );
      } else {
        const starterInformationSid = sid(state, "starterInformationSid");
        if (!starterInformationSid)
          return { ok: false, error: "registration_state_incomplete" };
        await client.updateStarterInformation(
          starterInformationSid,
          starterInformationAttributes(input),
        );
        nextStep = "resubmit_sole_information";
      }
      const next = { ...state, step: nextStep };
      await save(slug, lease, next, { smsLineStatus: "pending" });
      return { ok: true, status: "pending", step: next.step };
    }
    if (brandType === "STANDARD") {
      const business = await client.createBusinessInformation({
        friendlyName: "Uptempo " + slug + " business information",
        attributes: businessAttributes(
          input,
          tenant.industry,
          einDigits(input.ein!),
        ),
      });
      const started = withResource(
        { ...state, step: "create_secondary_profile" },
        "businessInformationSid",
        business.sid,
      );
      await save(slug, lease, started, { smsLineStatus: "pending" });
      return { ok: true, status: "pending", step: started.step };
    }
    const profile = await client.createProfile({
      friendlyName: "Uptempo " + slug + " sole proprietor profile",
      email: REGISTRATION_EMAIL,
      policySid: SOLE_PROFILE_POLICY,
    });
    const started = withResource(
      { ...state, step: "create_starter_information" },
      "customerProfileSid",
      profile.sid,
    );
    await save(slug, lease, started, { smsLineStatus: "pending" });
    return { ok: true, status: "pending", step: started.step };
  });
}

/** Turns off only the hosted sender status; approval resources stay reusable. */
export async function turnOffRegistrationLine(
  slug: string,
): Promise<RegistrationResult> {
  if (isSingleMode()) return { ok: false, error: "single_mode" };
  return withLease(slug, async (lease, tenant) => {
    const state = tenant.smsRegistration ?? {};
    if (tenant.smsLineStatus === "active") {
      await save(slug, lease, state, { smsLineStatus: "off" });
      return { ok: true, status: "off" };
    }
    if (tenant.smsLineStatus === "off" && state.status === "active") {
      return { ok: true, status: "off" };
    }
    return { ok: false, error: "text_line_not_active" };
  });
}

/** Reuses a previously approved number without creating or buying Twilio resources. */
export async function reactivateRegistrationLine(
  slug: string,
): Promise<RegistrationResult> {
  if (isSingleMode()) return { ok: false, error: "single_mode" };
  return withLease(slug, async (lease, tenant) => {
    const state = tenant.smsRegistration ?? {};
    if (tenant.smsLineStatus === "active")
      return { ok: true, status: "active" };
    if (
      tenant.smsLineStatus !== "off" ||
      state.status !== "active" ||
      !tenant.smsMessagingServiceSid ||
      !tenant.smsPhoneNumber
    ) {
      return { ok: false, error: "registration_not_complete" };
    }
    await save(slug, lease, state, { smsLineStatus: "active" });
    return { ok: true, status: "active" };
  });
}

/** Advances one external mutation or one status poll, checkpointing before return. */
export async function advanceRegistration(
  slug: string,
): Promise<RegistrationResult> {
  if (isSingleMode()) return { ok: false, error: "single_mode" };
  if (!process.env.TWILIO_PRIMARY_CUSTOMER_PROFILE_SID)
    return { ok: false, error: "registration_not_configured" };
  return withLease(slug, async (lease, tenant) => {
    const state = tenant.smsRegistration ?? {};
    if (tenant.smsLineStatus === "active") {
      try {
        const billing = await import("@/lib/billing/subscriptions");
        await billing.syncHostedSubscription(slug);
      } catch {
        return { ok: false, error: "billing_sync_retryable", retryable: true };
      }
      return { ok: true, status: "active" };
    }
    if (
      tenant.smsLineStatus !== "pending" &&
      !(
        tenant.smsLineStatus === "action_needed" &&
        state.reason === "confirm_text"
      )
    ) {
      return { ok: false, error: "registration_not_pending" };
    }
    const input = restoreInput(state);
    if (!input) return { ok: false, error: "registration_state_incomplete" };
    const client = await getRegistrationClient();
    const primarySid = process.env.TWILIO_PRIMARY_CUSTOMER_PROFILE_SID!;
    const profileSid = sid(state, "customerProfileSid");
    const trustSid = sid(state, "trustProductSid");
    const profilePolicy =
      state.brandType === "SOLE_PROPRIETOR"
        ? SOLE_PROFILE_POLICY
        : SECONDARY_PROFILE_POLICY;
    const trustPolicy =
      state.brandType === "SOLE_PROPRIETOR"
        ? SOLE_TRUST_POLICY
        : A2P_TRUST_PRODUCT_POLICY;
    const step = state.step ?? "";
    let result: RegistrationResource;
    let next: SmsRegistrationState;
    switch (step) {
      case "resubmit_sole_information":
        if (sid(state, "soleProprietorInformationSid")) {
          await client.updateSoleProprietorInformation(
            sid(state, "soleProprietorInformationSid"),
            soleProprietorInformationAttributes(input, tenant.industry),
          );
        }
        next = await checkpoint(slug, lease, state, "resubmit_address");
        break;
      case "resubmit_representative":
        if (sid(state, "representativeSid")) {
          await client.updateRepresentative(
            sid(state, "representativeSid"),
            representativeAttributes(input),
          );
        }
        next = await checkpoint(slug, lease, state, "resubmit_address");
        break;
      case "resubmit_address":
        if (sid(state, "addressSid")) {
          await client.updateAddress(
            sid(state, "addressSid"),
            input.legalBusinessName,
            input.businessAddress,
          );
        }
        next = await checkpoint(
          slug,
          lease,
          state,
          "resubmit_address_document",
        );
        break;
      case "resubmit_address_document":
        if (sid(state, "addressDocumentSid") && sid(state, "addressSid")) {
          await client.updateAddressDocument(
            sid(state, "addressDocumentSid"),
            sid(state, "addressSid"),
          );
        }
        next = await checkpoint(slug, lease, state, "evaluate_profile");
        break;
      case "resubmit_a2p_profile_information":
        if (sid(state, "a2pProfileInformationSid")) {
          await client.updateA2PProfileInformation(
            sid(state, "a2pProfileInformationSid"),
          );
        }
        next = await checkpoint(slug, lease, state, "evaluate_trust_product");
        break;
      case "create_starter_information":
        result = await client.createStarterInformation({
          friendlyName: "Uptempo " + slug + " starter profile information",
          attributes: starterInformationAttributes(input),
        });
        next = await checkpoint(
          slug,
          lease,
          state,
          "assign_starter_information",
          { key: "starterInformationSid", sid: result.sid },
        );
        break;
      case "assign_starter_information":
        result = await client.assignProfile(
          profileSid,
          sid(state, "starterInformationSid"),
        );
        next = await checkpoint(slug, lease, state, "create_address", {
          key: "starterInformationAssignmentSid",
          sid: result.sid,
        });
        break;
      case "create_secondary_profile":
        result = await client.createProfile({
          friendlyName: "Uptempo " + slug + " secondary profile",
          email: REGISTRATION_EMAIL,
          policySid: SECONDARY_PROFILE_POLICY,
        });
        next = await checkpoint(slug, lease, state, "create_representative", {
          key: "customerProfileSid",
          sid: result.sid,
        });
        break;
      case "create_representative":
        result = await client.createRepresentative({
          friendlyName: "Uptempo " + slug + " representative",
          attributes: representativeAttributes(input),
        });
        next = await checkpoint(
          slug,
          lease,
          state,
          "assign_business_information",
          { key: "representativeSid", sid: result.sid },
        );
        break;
      case "assign_business_information":
        result = await client.assignProfile(
          profileSid,
          sid(state, "businessInformationSid"),
        );
        next = await checkpoint(slug, lease, state, "assign_representative", {
          key: "businessAssignmentSid",
          sid: result.sid,
        });
        break;
      case "assign_representative":
        result = await client.assignProfile(
          profileSid,
          sid(state, "representativeSid"),
        );
        next = await checkpoint(slug, lease, state, "create_address", {
          key: "representativeAssignmentSid",
          sid: result.sid,
        });
        break;
      case "create_address":
        result = await client.createAddress({
          friendlyName: "Uptempo " + slug + " business address",
          businessName: input.legalBusinessName,
          address: input.businessAddress,
        });
        next = await checkpoint(slug, lease, state, "create_address_document", {
          key: "addressSid",
          sid: result.sid,
        });
        break;
      case "create_address_document":
        result = await client.createAddressDocument({
          friendlyName: "Uptempo " + slug + " address document",
          addressSid: sid(state, "addressSid"),
        });
        next = await checkpoint(slug, lease, state, "assign_address_document", {
          key: "addressDocumentSid",
          sid: result.sid,
        });
        break;
      case "assign_address_document":
        result = await client.assignProfile(
          profileSid,
          sid(state, "addressDocumentSid"),
        );
        next = await checkpoint(
          slug,
          lease,
          state,
          state.brandType === "SOLE_PROPRIETOR"
            ? "assign_primary_to_starter"
            : "assign_profile_to_primary",
          { key: "addressAssignmentSid", sid: result.sid },
        );
        break;
      case "assign_profile_to_primary":
        result = await client.assignProfileToPrimary(primarySid, profileSid);
        next = await checkpoint(slug, lease, state, "evaluate_profile", {
          key: "primaryAssignmentSid",
          sid: result.sid,
        });
        break;
      case "assign_primary_to_starter":
        result = await client.assignPrimaryToStarter(profileSid, primarySid);
        next = await checkpoint(slug, lease, state, "evaluate_profile", {
          key: "primaryAssignmentSid",
          sid: result.sid,
        });
        break;
      case "evaluate_profile": {
        const evaluation = await client.evaluateProfile(
          profileSid,
          profilePolicy,
        );
        if (!evaluation.compliant) {
          const rejected = needsAction(
            withResource(state, "profileEvaluationSid", evaluation.sid),
            "business_rejected",
            "Twilio needs corrected business information before registration can continue.",
            "resubmit_business_information",
          );
          await save(slug, lease, rejected, { smsLineStatus: "action_needed" });
          return {
            ok: true,
            status: "action_needed",
            reason: "business_rejected",
          };
        }
        next = await checkpoint(slug, lease, state, "submit_profile", {
          key: "profileEvaluationSid",
          sid: evaluation.sid,
        });
        break;
      }
      case "submit_profile":
        await client.submitProfile(profileSid);
        next = await checkpoint(
          slug,
          lease,
          state,
          trustSid
            ? state.brandType === "SOLE_PROPRIETOR"
              ? "evaluate_trust_product"
              : "resubmit_a2p_profile_information"
            : "create_trust_product",
        );
        break;
      case "create_trust_product":
        result = await client.createTrustProduct({
          friendlyName: "Uptempo " + slug + " A2P trust bundle",
          email: REGISTRATION_EMAIL,
          policySid:
            state.brandType === "SOLE_PROPRIETOR"
              ? SOLE_TRUST_POLICY
              : A2P_TRUST_PRODUCT_POLICY,
        });
        next = await checkpoint(
          slug,
          lease,
          state,
          state.brandType === "SOLE_PROPRIETOR"
            ? "create_sole_proprietor_information"
            : "create_a2p_profile_information",
          { key: "trustProductSid", sid: result.sid },
        );
        break;
      case "create_a2p_profile_information":
        result = await client.createA2PProfileInformation({
          friendlyName: "Uptempo " + slug + " A2P profile information",
        });
        next = await checkpoint(
          slug,
          lease,
          state,
          "assign_a2p_profile_information",
          { key: "a2pProfileInformationSid", sid: result.sid },
        );
        break;
      case "create_sole_proprietor_information":
        result = await client.createSoleProprietorInformation({
          friendlyName: "Uptempo " + slug + " sole proprietor A2P information",
          attributes: soleProprietorInformationAttributes(
            input,
            tenant.industry,
          ),
        });
        next = await checkpoint(
          slug,
          lease,
          state,
          "assign_sole_proprietor_information",
          { key: "soleProprietorInformationSid", sid: result.sid },
        );
        break;
      case "assign_sole_proprietor_information":
        result = await client.assignTrustProduct(
          trustSid,
          sid(state, "soleProprietorInformationSid"),
        );
        next = await checkpoint(
          slug,
          lease,
          state,
          "assign_profile_to_trust_product",
          { key: "soleInformationAssignmentSid", sid: result.sid },
        );
        break;
      case "assign_a2p_profile_information":
        result = await client.assignTrustProduct(
          trustSid,
          sid(state, "a2pProfileInformationSid"),
        );
        next = await checkpoint(
          slug,
          lease,
          state,
          "assign_profile_to_trust_product",
          { key: "a2pInformationAssignmentSid", sid: result.sid },
        );
        break;
      case "assign_profile_to_trust_product":
        result = await client.assignTrustProduct(trustSid, profileSid);
        next = await checkpoint(slug, lease, state, "evaluate_trust_product", {
          key: "trustProfileAssignmentSid",
          sid: result.sid,
        });
        break;
      case "evaluate_trust_product": {
        const evaluation = await client.evaluateTrustProduct(
          trustSid,
          trustPolicy,
        );
        if (!evaluation.compliant) {
          const rejected = needsAction(
            withResource(state, "trustEvaluationSid", evaluation.sid),
            "business_rejected",
            "Twilio needs corrected business information before registration can continue.",
            "resubmit_business_information",
          );
          await save(slug, lease, rejected, { smsLineStatus: "action_needed" });
          return {
            ok: true,
            status: "action_needed",
            reason: "business_rejected",
          };
        }
        next = await checkpoint(slug, lease, state, "submit_trust_product", {
          key: "trustEvaluationSid",
          sid: evaluation.sid,
        });
        break;
      }
      case "submit_trust_product":
        await client.submitTrustProduct(trustSid);
        next = await checkpoint(
          slug,
          lease,
          state,
          sid(state, "brandSid") ? "resubmit_brand" : "create_brand",
        );
        break;
      case "create_brand":
        if (sid(state, "brandSid")) {
          await client.updateBrand(sid(state, "brandSid"));
          next = await checkpoint(slug, lease, state, "check_brand");
          break;
        }
        result = await client.createBrand({
          brandType: state.brandType ?? "STANDARD",
          customerProfileSid: profileSid,
          trustProductSid: trustSid,
        });
        next = await checkpoint(
          slug,
          lease,
          state,
          "check_brand",
          { key: "brandSid", sid: result.sid },
          { smsBrandId: result.sid },
        );
        break;
      case "resubmit_brand":
        await client.updateBrand(sid(state, "brandSid"));
        next = await checkpoint(slug, lease, state, "check_brand");
        break;
      case "check_brand": {
        const status = await client.fetchBrand(sid(state, "brandSid"));
        if (status.status === "FAILED") {
          const rejected = needsAction(
            state,
            "business_rejected",
            businessRejectionMessage(status.reasonCode),
            "resubmit_business_information",
          );
          await save(slug, lease, rejected, { smsLineStatus: "action_needed" });
          return {
            ok: true,
            status: "action_needed",
            reason: "business_rejected",
          };
        }
        if (status.status !== "APPROVED")
          return { ok: true, status: "pending", step };
        if (
          state.brandType === "SOLE_PROPRIETOR" &&
          status.identityStatus !== "VERIFIED" &&
          status.identityStatus !== "VETTED_VERIFIED"
        ) {
          const confirm = needsAction(
            state,
            "confirm_text",
            "Reply YES to Twilio's verification text, then registration will continue automatically.",
            "check_brand",
          );
          await save(slug, lease, confirm, { smsLineStatus: "action_needed" });
          return { ok: true, status: "action_needed", reason: "confirm_text" };
        }
        const verified =
          state.reason === "confirm_text"
            ? {
                ...state,
                status: "submitted" as const,
                reason: undefined,
                reasonMessage: undefined,
              }
            : state;
        next = await checkpoint(
          slug,
          lease,
          verified,
          "create_messaging_service",
          undefined,
          state.reason === "confirm_text" ? { smsLineStatus: "pending" } : {},
        );
        break;
      }
      case "create_messaging_service":
        result = await client.createMessagingService({
          friendlyName: "Uptempo " + slug + " reminders",
          inboundRequestUrl: platformUrl(slug, "/api/twilio/inbound"),
          statusCallback: platformUrl(
            slug,
            "/api/twilio/status?tenant=" + encodeURIComponent(slug),
          ),
        });
        next = await checkpoint(
          slug,
          lease,
          state,
          "create_campaign",
          { key: "messagingServiceSid", sid: result.sid },
          { smsMessagingServiceSid: result.sid },
        );
        break;
      case "create_campaign": {
        const sample = await makeSamples(slug, input.legalBusinessName);
        const existingCampaignSid = sid(state, "campaignSid");
        const usecase =
          state.brandType === "SOLE_PROPRIETOR"
            ? "SOLE_PROPRIETOR"
            : "LOW_VOLUME";
        if (existingCampaignSid) {
          await client.updateCampaign({
            messagingServiceSid: sid(state, "messagingServiceSid"),
            campaignSid: existingCampaignSid,
            brandSid: sid(state, "brandSid"),
            usecase,
            ...sample,
          });
          next = await checkpoint(slug, lease, state, "check_campaign");
          break;
        }
        result = await client.createCampaign({
          messagingServiceSid: sid(state, "messagingServiceSid"),
          brandSid: sid(state, "brandSid"),
          usecase,
          ...sample,
        });
        next = await checkpoint(
          slug,
          lease,
          state,
          "check_campaign",
          { key: "campaignSid", sid: result.sid },
          { smsCampaignId: result.sid },
        );
        break;
      }
      case "check_campaign": {
        const status = await client.fetchCampaign(
          sid(state, "messagingServiceSid"),
          sid(state, "campaignSid"),
        );
        if (status.status === "FAILED") {
          const rejected = needsAction(
            state,
            "registration_failed",
            campaignRejectionMessage(status.reasonCode),
            "create_campaign",
          );
          await save(slug, lease, rejected, { smsLineStatus: "action_needed" });
          return {
            ok: true,
            status: "action_needed",
            reason: "registration_failed",
          };
        }
        if (status.status !== "VERIFIED")
          return { ok: true, status: "pending", step };
        next = await checkpoint(slug, lease, state, "find_local_number");
        break;
      }
      case "find_local_number": {
        const candidateAreaCode = input.owner.mobile.startsWith("+1")
          ? input.owner.mobile.slice(2, 5)
          : "";
        const areaCode = /^[2-9]\d{2}$/.test(candidateAreaCode)
          ? candidateAreaCode
          : "";
        const local = areaCode
          ? await client.findLocalNumber({
              areaCode,
              region: input.businessAddress.state,
            })
          : null;
        const selected =
          local ??
          (await client.findLocalNumber({
            areaCode: "",
            region: input.businessAddress.state,
          }));
        if (!selected)
          return {
            ok: false,
            error: "no_local_number_available",
            retryable: true,
          };
        next = await checkpoint(slug, lease, state, "purchase_number", {
          key: "selectedNumber",
          sid: selected.phoneNumber,
        });
        break;
      }
      case "purchase_number":
        result = await client.purchaseNumber({
          phoneNumber: sid(state, "selectedNumber"),
          friendlyName: "Uptempo " + slug,
          inboundRequestUrl: platformUrl(slug, "/api/twilio/inbound"),
          statusCallback: platformUrl(
            slug,
            "/api/twilio/status?tenant=" + encodeURIComponent(slug),
          ),
        });
        next = await checkpoint(
          slug,
          lease,
          state,
          "attach_number",
          { key: "phoneNumberSid", sid: result.sid },
          {
            smsPhoneNumber: (
              result as RegistrationResource & { phoneNumber: string }
            ).phoneNumber,
          },
        );
        break;
      case "attach_number":
        result = await client.attachNumber(
          sid(state, "messagingServiceSid"),
          sid(state, "phoneNumberSid"),
          sid(state, "selectedNumber"),
          "Uptempo " + slug,
        );
        next = await checkpoint(slug, lease, state, "activate", {
          key: "servicePhoneAssignmentSid",
          sid: result.sid,
        });
        break;
      case "activate": {
        const active: SmsRegistrationState = {
          ...state,
          status: "active",
          step: "active",
          submittedAt: state.submittedAt ?? new Date().toISOString(),
          reason: undefined,
          reasonMessage: undefined,
        };
        await save(slug, lease, active, { smsLineStatus: "active" });
        try {
          const billing = await import("@/lib/billing/subscriptions");
          await billing.syncHostedSubscription(slug);
        } catch {
          return {
            ok: false,
            error: "billing_sync_retryable",
            retryable: true,
          };
        }
        return { ok: true, status: "active" };
      }
      default:
        return { ok: false, error: "registration_state_incomplete" };
    }
    return { ok: true, status: "pending", step: next.step };
  });
}

export async function resendConfirmation(
  slug: string,
): Promise<RegistrationResult> {
  if (isSingleMode()) return { ok: false, error: "single_mode" };
  if (!process.env.TWILIO_PRIMARY_CUSTOMER_PROFILE_SID)
    return { ok: false, error: "registration_not_configured" };
  return withLease(slug, async (lease, tenant) => {
    const state = tenant.smsRegistration ?? {};
    if (
      tenant.smsLineStatus !== "action_needed" ||
      state.reason !== "confirm_text" ||
      !state.resources?.brandSid
    ) {
      return { ok: false, error: "confirmation_not_available" };
    }
    await (
      await getRegistrationClient()
    ).resendBrandOtp(state.resources.brandSid);
    await save(slug, lease, {
      ...state,
      confirmationSentAt: new Date().toISOString(),
    });
    return { ok: true, status: "action_needed", reason: "confirmation_sent" };
  });
}
