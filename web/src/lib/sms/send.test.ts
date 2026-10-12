import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getTwilioClient, sendViaLoopMessage, inserted, withTenantDb } = vi.hoisted(() => ({
  getTwilioClient: vi.fn(),
  sendViaLoopMessage: vi.fn(),
  inserted: [] as unknown[],
  withTenantDb: vi.fn(),
}));

vi.mock("./client", () => ({ getTwilioClient, getMessagingServiceSid: vi.fn() }));
vi.mock("./loopmessage", () => ({ sendViaLoopMessage }));
vi.mock("./quiet-hours", () => ({ isWithinSendWindow: () => true }));
vi.mock("@/lib/db/tenant", () => ({
  // One fake tenant db: consent lookup, timezone lookup and the sms_messages insert.
  withTenantDb,
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
    chain.limit = async () => [
      { consentedAt: new Date(), optedOutAt: null, timezone: "America/New_York" },
    ];
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
    withTenantDb.mockClear();
  });
  afterEach(() => {
    delete process.env.SMS_PROVIDER;
  });

  it("returns sms_disabled and does not touch the database", async () => {
    const res = await sendSms({ to: "+15555550100", body: "hi", tenantSlug: "t" });
    expect(res).toEqual({ success: false, error: "sms_disabled" });
    expect(withTenantDb).not.toHaveBeenCalled();
  });
});
