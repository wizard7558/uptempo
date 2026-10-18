import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  single: false,
  syncHostedSubscription: vi.fn(async () => ({ created: 0, updated: 0, removed: 0 })),
  settings: {
    smsConfirmationBody: "Hi {client}, you're booked with {staff} on {date} at {time}. Services: {services}.",
    smsReminderBody: "Reminder: {services} with {staff} on {date} at {time}. To cancel/reschedule: {link}",
  },
}));
const twilioSdk = vi.hoisted(() => vi.fn());

vi.mock("@/lib/config/mode", () => ({ isSingleMode: () => harness.single }));
vi.mock("twilio", () => ({ default: twilioSdk }));
vi.mock("@/lib/notifications/settings", () => ({
  getNotificationSettingsForTenant: async () => harness.settings,
}));
vi.mock("@/lib/billing/subscriptions", () => ({
  syncHostedSubscription: harness.syncHostedSubscription,
}));

import { eq } from "drizzle-orm";
import { tenants } from "@/lib/db/schema";
import { publicDb } from "@/lib/db";
import {
  createFakeRegistrationClient,
  createFakeRegistrationRecorder,
  resetFakeRegistrationClient,
} from "./fake-registration-client";
import {
  advanceRegistration,
  RegistrationInput,
  resendConfirmation,
  setRegistrationClientFactoryForTests,
  startRegistration,
  twilioIndustryFor,
} from "./registration";
import type { FakeRegistrationOptions, FakeRegistrationRecorder } from "./fake-registration-client";
import type { ScratchTenant } from "@/lib/scheduling/db-fixtures";

const databaseUrl = process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;
const scratches: ScratchTenant[] = [];

const standardInput = {
  legalBusinessName: "Juniper Salon LLC",
  ein: "12-3456789",
  businessType: "LLC" as const,
  businessAddress: {
    street: "123 Market Street",
    city: "Seattle",
    state: "WA",
    postalCode: "98101",
  },
  website: "https://juniper.example",
  owner: {
    firstName: "Jordan",
    lastName: "Lee",
    title: "Owner",
    email: "jordan@example.test",
    mobile: "+12065550123",
  },
};

const soleProprietorInput = {
  ...standardInput,
  legalBusinessName: "Juniper Wellness",
  ein: undefined,
  businessType: "SOLE_PROPRIETOR" as const,
};

async function scratch(tag: string) {
  const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
  const t = await scratchTenant(tag);
  scratches.push(t);
  return t;
}

async function tenant(slug: string) {
  const [row] = await publicDb.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
  return row;
}

function useFake(options: FakeRegistrationOptions = {}) {
  const recorder = options.recorder ?? createFakeRegistrationRecorder();
  const sharedOptions = { ...options, recorder };
  setRegistrationClientFactoryForTests(() => createFakeRegistrationClient(sharedOptions));
  return { recorder, options: sharedOptions };
}

function rawEins(recorder: FakeRegistrationRecorder): string[] {
  return recorder.calls.flatMap((call) => call.hasEin ? [`${call.einLast4 ?? ""}`] : []);
}

async function advanceUntil(
  slug: string,
  predicate: (row: Awaited<ReturnType<typeof tenant>>) => boolean,
  max = 80,
) {
  for (let i = 0; i < max; i++) {
    const row = await tenant(slug);
    if (row && predicate(row)) return row;
    const before = useFakeCurrentRecorder?.calls.length ?? 0;
    const result = await advanceRegistration(slug);
    if (!result.ok && result.error !== "registration_in_progress") {
      throw new Error(`registration_advance_failed:${result.error}`);
    }
    const after = useFakeCurrentRecorder?.calls.length ?? 0;
    expect(after - before).toBeLessThanOrEqual(1);
  }
  throw new Error("registration_did_not_reach_expected_state");
}

let useFakeCurrentRecorder: FakeRegistrationRecorder | null = null;
function useFakeTracked(options: FakeRegistrationOptions = {}) {
  const result = useFake(options);
  useFakeCurrentRecorder = result.recorder;
  return result;
}

afterEach(() => {
  setRegistrationClientFactoryForTests(null);
  useFakeCurrentRecorder = null;
  harness.single = false;
  vi.clearAllMocks();
});

afterAll(async () => {
  for (const t of scratches) await t.drop();
});

describe("SMS business registration state machine", () => {
  it("validates EIN and maps every registered Uptempo vertical", () => {
    expect(RegistrationInput.safeParse(standardInput).success).toBe(true);
    expect(RegistrationInput.safeParse({ ...standardInput, ein: "12345" }).success).toBe(false);
    expect({
      hair_salon: twilioIndustryFor("hair_salon"),
      barber: twilioIndustryFor("barber"),
      nail_salon: twilioIndustryFor("nail_salon"),
      tattoo: twilioIndustryFor("tattoo"),
      massage_wellness: twilioIndustryFor("massage_wellness"),
      personal_training: twilioIndustryFor("personal_training"),
      home_services: twilioIndustryFor("home_services"),
      general: twilioIndustryFor("general"),
      future: twilioIndustryFor("future_vertical"),
    }).toEqual({
      hair_salon: "CONSUMER",
      barber: "CONSUMER",
      nail_salon: "CONSUMER",
      tattoo: "CONSUMER",
      massage_wellness: "HEALTHCARE",
      personal_training: "HEALTHCARE",
      home_services: "PROFESSIONAL",
      general: "OTHER",
      future: "OTHER",
    });
  });

  it("blocks single mode and missing primary-profile configuration before fake calls", async () => {
    const { recorder } = useFakeTracked();
    harness.single = true;
    delete process.env.TWILIO_PRIMARY_CUSTOMER_PROFILE_SID;
    expect(await startRegistration("not-created", standardInput)).toEqual({ ok: false, error: "single_mode" });
    harness.single = false;
    expect(await startRegistration("not-created", standardInput)).toEqual({ ok: false, error: "registration_not_configured" });
    expect(await advanceRegistration("not-created")).toEqual({ ok: false, error: "registration_not_configured" });
    expect(recorder.calls).toEqual([]);
    process.env.TWILIO_PRIMARY_CUSTOMER_PROFILE_SID = "BU-primary-test";
  });

  describeDb("with a disposable PostgreSQL database", () => {
    it("activates standard registration, checkpoints one operation at a time, and never stores the full EIN", async () => {
      process.env.TWILIO_PRIMARY_CUSTOMER_PROFILE_SID = "BU-primary-test";
      const t = await scratch("smsregstd");
      await publicDb.update(tenants).set({ smsLineStatus: "shared", industry: "hair_salon" }).where(eq(tenants.slug, t.slug));
      const { recorder } = useFakeTracked();

      expect(await startRegistration(t.slug, standardInput)).toMatchObject({ ok: true, status: "pending" });
      expect(await startRegistration(t.slug, standardInput)).toMatchObject({ ok: true, status: "pending" });
      expect(recorder.calls.filter((call) => call.method === "createBusinessInformation")).toHaveLength(1);
      let row = await tenant(t.slug);
      expect(JSON.stringify(row?.smsRegistration)).not.toContain("123456789");
      expect(row?.smsRegistration).toMatchObject({ einLast4: "6789", startedFromShared: true, setupFeeEligible: false });
      expect(rawEins(recorder)).toEqual(["6789"]);
      expect(JSON.stringify(recorder.calls)).not.toContain("123456789");

      row = await advanceUntil(t.slug, (current) => current?.smsLineStatus === "active");
      expect(row?.smsBrandId).toMatch(/^BU/);
      expect(row?.smsCampaignId).toMatch(/^BU/);
      expect(row?.smsMessagingServiceSid).toMatch(/^BU/);
      expect(row?.smsPhoneNumber).toBe("+12065550100");
      expect(recorder.calls.filter((call) => call.method === "createBrand")).toHaveLength(1);
      expect(recorder.calls.filter((call) => call.method === "createTrustProduct")).toHaveLength(1);
      const campaign = recorder.calls.find((call) => call.method === "createCampaign");
      expect(campaign?.usecase).toBe("LOW_VOLUME");
      expect(campaign?.messageSamples).toEqual([
        "Hi Jordan, you're booked with Alex on Monday, October 19 at 2:30 PM. Services: appointment.",
        "Reminder: appointment with Alex on Monday, October 19 at 2:30 PM. To cancel/reschedule: http://localhost:3000/reschedule/sample",
      ]);
      expect(harness.syncHostedSubscription).toHaveBeenCalledWith(t.slug);
    }, 60_000);

    it("resumes sole-proprietor OTP verification and completes without an EIN", async () => {
      process.env.TWILIO_PRIMARY_CUSTOMER_PROFILE_SID = "BU-primary-test";
      const t = await scratch("smsregsole");
      await publicDb.update(tenants).set({ smsLineStatus: "off", industry: "massage_wellness" }).where(eq(tenants.slug, t.slug));
      let identityStatus = "SELF_DECLARED";
      const fakeOptions = { identityStatus: () => identityStatus };
      const { recorder } = useFakeTracked(fakeOptions);
      expect(await startRegistration(t.slug, soleProprietorInput)).toMatchObject({ ok: true, status: "pending" });
      let row = await advanceUntil(t.slug, (current) => current?.smsLineStatus === "action_needed");
      expect(row?.smsRegistration.reason).toBe("confirm_text");
      expect(row?.smsRegistration.step).toBe("check_brand");
      expect(await advanceRegistration(t.slug)).toMatchObject({ ok: true, status: "action_needed", reason: "confirm_text" });
      expect(await resendConfirmation(t.slug)).toMatchObject({ ok: true, reason: "confirmation_sent" });
      row = await tenant(t.slug);
      expect(row?.smsRegistration.confirmationSentAt).toBeTruthy();
      expect(recorder.calls.filter((call) => call.method === "resendBrandOtp")).toHaveLength(1);
      expect(await advanceRegistration(t.slug)).toMatchObject({ ok: true, status: "action_needed", reason: "confirm_text" });
      row = await tenant(t.slug);
      expect(row?.smsRegistration.reason).toBe("confirm_text");
      identityStatus = "VERIFIED";
      row = await advanceUntil(t.slug, (current) => current?.smsLineStatus === "active");
      expect(row?.smsRegistration.brandType).toBe("SOLE_PROPRIETOR");
      expect(row?.smsRegistration.reason).toBeUndefined();
      expect(row?.smsRegistration.reasonMessage).toBeUndefined();
      expect(row?.smsRegistration.input).not.toHaveProperty("ein");
      expect(recorder.calls.find((call) => call.method === "createStarterInformation")?.attributes).toEqual([
        "email", "first_name", "last_name", "phone_number",
      ]);
      expect(recorder.calls.find((call) => call.method === "createSoleProprietorInformation")?.attributes).toEqual([
        "brand_name", "mobile_phone_number", "vertical",
      ]);
      expect(recorder.calls.some((call) => call.method === "assignPrimaryToStarter")).toBe(true);
      expect(recorder.calls.some((call) => call.method === "createA2PProfileInformation")).toBe(false);
      expect(recorder.calls.find((call) => call.method === "createCampaign")?.usecase).toBe("SOLE_PROPRIETOR");
      expect(recorder.calls.filter((call) => call.method === "createBrand")).toHaveLength(1);
    }, 60_000);

    it.each(["profile", "trust"] as const)("atomically checkpoints and resumes a rejected %s evaluation", async (failurePoint) => {
      process.env.TWILIO_PRIMARY_CUSTOMER_PROFILE_SID = "BU-primary-test";
      const t = await scratch(`smsreg-${failurePoint}-rejection`);
      await publicDb.update(tenants).set({ smsLineStatus: "off", industry: "barber" }).where(eq(tenants.slug, t.slug));
      let profileEvaluations = 0;
      let trustEvaluations = 0;
      const { recorder } = useFakeTracked({
        profileCompliant: () => ++profileEvaluations > (failurePoint === "profile" ? 1 : 0),
        trustProductCompliant: () => ++trustEvaluations > (failurePoint === "trust" ? 1 : 0),
      });
      await startRegistration(t.slug, standardInput);
      let row = await advanceUntil(t.slug, (current) => current?.smsLineStatus === "action_needed");
      expect(row?.smsRegistration.reason).toBe("business_rejected");
      expect(row?.smsRegistration.step).toBe("resubmit_business_information");
      expect(row?.smsRegistration.resources?.[failurePoint === "profile" ? "profileEvaluationSid" : "trustEvaluationSid"]).toBeTruthy();

      expect(await startRegistration(t.slug, standardInput)).toMatchObject({ ok: true, status: "pending" });
      row = await tenant(t.slug);
      expect(row?.smsRegistration.step).toBe("resubmit_representative");
      row = await advanceUntil(t.slug, (current) => current?.smsLineStatus === "active");
      expect(row?.smsLineStatus).toBe("active");
      expect(recorder.calls.filter((call) => call.method === "createBusinessInformation")).toHaveLength(1);
      expect(recorder.calls.filter((call) => call.method === "createProfile")).toHaveLength(1);
      expect(recorder.calls.filter((call) => call.method === (failurePoint === "profile" ? "evaluateProfile" : "evaluateTrustProduct"))).toHaveLength(2);
    }, 60_000);

    it("serializes concurrent advances at brand creation", async () => {
      process.env.TWILIO_PRIMARY_CUSTOMER_PROFILE_SID = "BU-primary-test";
      const t = await scratch("smsreglock");
      await publicDb.update(tenants).set({ smsLineStatus: "off", industry: "barber" }).where(eq(tenants.slug, t.slug));
      const { recorder } = useFakeTracked({ delayOnceAt: "createBrand", delayMs: 80 });
      await startRegistration(t.slug, standardInput);
      await advanceUntil(t.slug, (current) => current?.smsRegistration.step === "create_brand");

      const [first, second] = await Promise.all([advanceRegistration(t.slug), advanceRegistration(t.slug)]);
      expect([first, second].filter((result) => !result.ok && result.error === "registration_in_progress")).toHaveLength(1);
      expect(recorder.calls.filter((call) => call.method === "createBrand")).toHaveLength(1);
      const row = await advanceUntil(t.slug, (current) => current?.smsLineStatus === "active");
      expect(row?.smsLineStatus).toBe("active");
      expect(recorder.calls.filter((call) => call.method === "purchaseNumber")).toHaveLength(1);
    }, 60_000);

    it("resubmits existing brand and campaign resources without creating paid replacements", async () => {
      process.env.TWILIO_PRIMARY_CUSTOMER_PROFILE_SID = "BU-primary-test";
      const t = await scratch("smsregretry");
      await publicDb.update(tenants).set({ smsLineStatus: "off", industry: "nail_salon" }).where(eq(tenants.slug, t.slug));
      let brandStatus = "FAILED";
      let campaignStatus = "VERIFIED";
      const retryOptions: FakeRegistrationOptions = {
        brandStatus: () => brandStatus,
        campaignStatus: () => campaignStatus,
      };
      const { recorder } = useFakeTracked(retryOptions);
      await startRegistration(t.slug, standardInput);
      let row = await advanceUntil(t.slug, (current) => current?.smsLineStatus === "action_needed");
      expect(row?.smsRegistration.reason).toBe("business_rejected");
      const brandSid = row?.smsBrandId;
      expect(brandSid).toBeTruthy();
      brandStatus = "APPROVED";
      await startRegistration(t.slug, { ...standardInput, legalBusinessName: "Juniper Salon LLC Updated" });
      row = await advanceUntil(t.slug, (current) => current?.smsLineStatus === "active");
      expect(row?.smsBrandId).toBe(brandSid);
      expect(recorder.calls.filter((call) => call.method === "createBrand")).toHaveLength(1);
      expect(recorder.calls.filter((call) => call.method === "updateBrand")).toHaveLength(1);
      expect(recorder.calls.filter((call) => call.method === "createTrustProduct")).toHaveLength(1);

      // A fresh tenant demonstrates the A2P Campaign retry path, which updates its existing SID.
      const second = await scratch("smsregcampaign");
      await publicDb.update(tenants).set({ smsLineStatus: "off", industry: "general" }).where(eq(tenants.slug, second.slug));
      brandStatus = "APPROVED";
      campaignStatus = "FAILED";
      await startRegistration(second.slug, standardInput);
      row = await advanceUntil(second.slug, (current) => current?.smsLineStatus === "action_needed");
      expect(row?.smsRegistration.reason).toBe("registration_failed");
      const campaignSid = row?.smsCampaignId;
      campaignStatus = "VERIFIED";
      await startRegistration(second.slug, standardInput);
      row = await advanceUntil(second.slug, (current) => current?.smsLineStatus === "active");
      expect(row?.smsCampaignId).toBe(campaignSid);
      expect(recorder.calls.filter((call) => call.method === "createCampaign")).toHaveLength(2);
      expect(recorder.calls.filter((call) => call.method === "updateCampaign")).toHaveLength(1);
    }, 120_000);
  });
});

describeDb("log registration transport", () => {
  it("uses the deterministic fake for start, advance, and resend without instantiating Twilio", async () => {
    const saved = {
      provider: process.env.SMS_PROVIDER,
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      primaryProfileSid: process.env.TWILIO_PRIMARY_CUSTOMER_PROFILE_SID,
    };
    try {
      process.env.SMS_PROVIDER = "log";
      process.env.TWILIO_ACCOUNT_SID = "AC-dummy-only";
      process.env.TWILIO_AUTH_TOKEN = "dummy-only";
      process.env.TWILIO_PRIMARY_CUSTOMER_PROFILE_SID = "BU-primary-test";
      setRegistrationClientFactoryForTests(null);
      resetFakeRegistrationClient();
      const t = await scratch("smsreg-log-fake");
      await publicDb.update(tenants).set({ smsLineStatus: "off", industry: "general" }).where(eq(tenants.slug, t.slug));
      expect(await startRegistration(t.slug, soleProprietorInput)).toEqual({ ok: true, status: "pending", step: "create_starter_information" });
      await advanceUntil(t.slug, (current) => current?.smsLineStatus === "action_needed");
      expect(await resendConfirmation(t.slug)).toMatchObject({ ok: true, reason: "confirmation_sent" });
      expect(await advanceRegistration(t.slug)).toMatchObject({ ok: true, status: "action_needed", reason: "confirm_text" });
      expect(twilioSdk).not.toHaveBeenCalled();
    } finally {
      setRegistrationClientFactoryForTests(null);
      if (saved.provider === undefined) delete process.env.SMS_PROVIDER;
      else process.env.SMS_PROVIDER = saved.provider;
      if (saved.accountSid === undefined) delete process.env.TWILIO_ACCOUNT_SID;
      else process.env.TWILIO_ACCOUNT_SID = saved.accountSid;
      if (saved.authToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
      else process.env.TWILIO_AUTH_TOKEN = saved.authToken;
      if (saved.primaryProfileSid === undefined) delete process.env.TWILIO_PRIMARY_CUSTOMER_PROFILE_SID;
      else process.env.TWILIO_PRIMARY_CUSTOMER_PROFILE_SID = saved.primaryProfileSid;
    }
  }, 60_000);
});
