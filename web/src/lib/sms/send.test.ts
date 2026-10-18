import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getTwilioClient, getMessagingServiceSid, sendViaLoopMessage, inserted, withTenantDb, publicSelect, state } = vi.hoisted(() => ({
  getTwilioClient: vi.fn(),
  getMessagingServiceSid: vi.fn(),
  sendViaLoopMessage: vi.fn(),
  inserted: [] as unknown[],
  withTenantDb: vi.fn(),
  publicSelect: vi.fn(),
  state: {
    single: false,
    consent: true,
    withinSendWindow: true,
    tenant: { smsLineStatus: "active", smsMessagingServiceSid: "MG-tenant" } as null | { smsLineStatus: string; smsMessagingServiceSid: string | null },
  },
}));

vi.mock("./client", () => ({ getTwilioClient, getMessagingServiceSid }));
vi.mock("./loopmessage", () => ({ sendViaLoopMessage }));
vi.mock("./quiet-hours", () => ({ isWithinSendWindow: () => state.withinSendWindow }));
vi.mock("@/lib/db/tenant", () => ({
  // One fake tenant db: consent lookup, timezone lookup and the sms_messages insert.
  withTenantDb,
}));
vi.mock("@/lib/config/mode", () => ({ isSingleMode: () => state.single }));
vi.mock("@/lib/db", () => ({
  publicDb: {
    select: (...args: unknown[]) => {
      publicSelect(...args);
      return {
        from: () => ({
          where: () => ({ limit: async () => state.tenant ? [state.tenant] : [] }),
        }),
      };
    },
  },
}));

withTenantDb.mockImplementation(async (
    _slug: string,
    fn: (db: unknown, t: unknown) => unknown,
  ) => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.from = () => chain;
    chain.where = () => chain;
    chain.orderBy = () => chain;
    chain.limit = async () => state.consent
      ? [{ consentedAt: new Date(), optedOutAt: null, timezone: "America/New_York" }]
      : [];
    chain.insert = () => ({
      values: async (v: unknown) => {
        inserted.push(v);
      },
    });
    const t = {
      smsConsent: { phone: "", createdAt: "", consentedAt: "", optedOutAt: "" },
      businessSettings: { timezone: "" },
      smsMessages: {},
    };
    return fn(chain, t);
  });

import { sendSms } from "./send";
import { getSmsProvider } from "@/lib/providers/sms";

describe("sendSms with SMS_PROVIDER=log", () => {
  beforeEach(() => {
    process.env.SMS_PROVIDER = "log";
    inserted.length = 0;
    state.single = false;
    state.consent = true;
    state.withinSendWindow = true;
    state.tenant = { smsLineStatus: "active", smsMessagingServiceSid: "MG-tenant" };
    publicSelect.mockClear();
    withTenantDb.mockClear();
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    delete process.env.SMS_PROVIDER;
    vi.restoreAllMocks();
  });

  it("selects the log provider", () => {
    expect(getSmsProvider().id).toBe("log");
  });

  it("gives the transport straight quotes and a hyphen", async () => {
    await sendSms({
      to: "+15555550100",
      body: "Sam\u2019s \u201Ccut\u201D \u2014 tomorrow",
      tenantSlug: "t",
    });
    expect(console.info).toHaveBeenCalledWith(
      "[sms:log]",
      "+15555550100",
      'Sam\'s "cut" - tomorrow',
    );
    expect(inserted[0]).toMatchObject({ body: 'Sam\'s "cut" - tomorrow' });
  });

  it("sends nothing over the network and still logs to sms_messages", async () => {
    const res = await sendSms({ to: "+15555550100", body: "hi", tenantSlug: "t" });
    expect(res.success).toBe(true);
    expect(res.messageSid).toMatch(/^log-/);
    expect(getTwilioClient).not.toHaveBeenCalled();
    expect(sendViaLoopMessage).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ status: "queued", toPhone: "+15555550100" });
  });
});

describe("sendSms with SMS_PROVIDER=none", () => {
  beforeEach(() => {
    process.env.SMS_PROVIDER = "none";
    delete process.env.TWILIO_ACCOUNT_SID;
    state.consent = true;
    state.withinSendWindow = true;
    withTenantDb.mockClear();
    publicSelect.mockClear();
  });
  afterEach(() => {
    delete process.env.SMS_PROVIDER;
  });

  it("returns sms_disabled and does not touch the database", async () => {
    const res = await sendSms({ to: "+15555550100", body: "hi", tenantSlug: "t" });
    expect(res).toEqual({ success: false, error: "sms_disabled" });
    expect(withTenantDb).not.toHaveBeenCalled();
    expect(publicSelect).not.toHaveBeenCalled();
  });
});

describe("hosted text-line sending", () => {
  beforeEach(() => {
    process.env.SMS_PROVIDER = "log";
    state.single = false;
    state.consent = true;
    state.withinSendWindow = true;
    state.tenant = { smsLineStatus: "active", smsMessagingServiceSid: "MG-tenant" };
    inserted.length = 0;
    publicSelect.mockClear();
    withTenantDb.mockClear();
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    delete process.env.SMS_PROVIDER;
    vi.restoreAllMocks();
  });

  it.each(["off", "pending", "action_needed"])("blocks %s before consent, provider, or message logging", async (status) => {
    state.tenant = { smsLineStatus: status, smsMessagingServiceSid: "MG-tenant" };
    const res = await sendSms({ to: "+15555550100", body: "Appointment", tenantSlug: "t" });
    expect(res).toEqual({ success: false, error: "text_line_off" });
    expect(withTenantDb).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it("does not fall back to the shared service when an active tenant has no SID", async () => {
    state.tenant = { smsLineStatus: "active", smsMessagingServiceSid: null };
    const res = await sendSms({ to: "+15555550100", body: "Appointment", tenantSlug: "t" });
    expect(res).toEqual({ success: false, error: "text_line_off" });
    expect(withTenantDb).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it("keeps shared businesses on the pooled sender", async () => {
    state.tenant = { smsLineStatus: "shared", smsMessagingServiceSid: null };
    const res = await sendSms({ to: "+15555550100", body: "Appointment", tenantSlug: "t" });
    expect(res.success).toBe(true);
    expect(console.info).toHaveBeenCalled();
    expect(inserted).toHaveLength(1);
  });

  it("keeps consent and quiet-hours gates ahead of provider sends and message rows", async () => {
    state.consent = false;
    const noConsent = await sendSms({ to: "+15555550100", body: "Appointment", tenantSlug: "t" });
    expect(noConsent).toEqual({ success: false, error: "no_consent" });
    expect(console.info).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);

    state.consent = true;
    state.withinSendWindow = false;
    const quietHours = await sendSms({ to: "+15555550100", body: "Appointment", tenantSlug: "t" });
    expect(quietHours).toEqual({ success: false, error: "quiet_hours" });
    expect(console.info).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it("keeps single-mode transport independent of tenant registration state", async () => {
    state.single = true;
    state.tenant = null;
    const res = await sendSms({ to: "+15555550100", body: "Appointment", tenantSlug: "t" });
    expect(res.success).toBe(true);
    expect(publicSelect).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(1);
  });

  it("refuses hosted active lines when LoopMessage cannot use the tenant Twilio service", async () => {
    process.env.SMS_PROVIDER = "loopmessage";
    const res = await sendSms({ to: "+15555550100", body: "Appointment", tenantSlug: "t" });
    expect(res).toEqual({ success: false, error: "sms_provider_incompatible" });
    expect(sendViaLoopMessage).not.toHaveBeenCalled();
    expect(withTenantDb).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });
});

describe("Twilio sender routing for hosted and single tenants", () => {
  const messagesCreate = vi.fn();

  beforeEach(() => {
    process.env.SMS_PROVIDER = "twilio";
    process.env.TWILIO_ACCOUNT_SID = "AC-test";
    process.env.TWILIO_AUTH_TOKEN = "test-token";
    process.env.TWILIO_MESSAGING_SERVICE_SID = "MG-platform-shared";
    state.single = false;
    state.consent = true;
    state.withinSendWindow = true;
    state.tenant = { smsLineStatus: "active", smsMessagingServiceSid: "MG-tenant" };
    inserted.length = 0;
    publicSelect.mockClear();
    withTenantDb.mockClear();
    messagesCreate.mockReset().mockResolvedValue({ sid: "SM-test" });
    getTwilioClient.mockReturnValue({ messages: { create: messagesCreate } });
    getMessagingServiceSid.mockReturnValue("MG-platform-shared");
  });

  afterEach(() => {
    delete process.env.SMS_PROVIDER;
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_MESSAGING_SERVICE_SID;
    vi.restoreAllMocks();
  });

  it.each([
    { label: "hosted active", status: "active", single: false, expectedService: "MG-tenant" },
    { label: "hosted shared", status: "shared", single: false, expectedService: "MG-platform-shared" },
    { label: "single mode", status: "off", single: true, expectedService: "MG-platform-shared" },
  ])("routes $label through its intended Messaging Service", async ({ status, single, expectedService }) => {
    state.single = single;
    state.tenant = single ? null : { smsLineStatus: status, smsMessagingServiceSid: status === "active" ? "MG-tenant" : null };
    const result = await sendSms({ to: "+15555550100", body: "Appointment confirmed", tenantSlug: "t" });
    expect(result).toEqual({ success: true, messageSid: "SM-test" });
    expect(messagesCreate).toHaveBeenCalledWith(expect.objectContaining({
      to: "+15555550100",
      messagingServiceSid: expectedService,
    }));
    if (single) expect(publicSelect).not.toHaveBeenCalled();
  });
});
