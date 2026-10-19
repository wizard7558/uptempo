// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/i18n/messages/en.json";

const STAFF = "11111111-1111-4111-8111-111111111111";
const ENTRY = "22222222-2222-4222-8222-222222222222";

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  assertModule: vi.fn(),
  claimEntry: vi.fn(),
  beginService: vi.fn(),
  endService: vi.fn(),
  sendSms: vi.fn(),
  loadQueueBoard: vi.fn(),
  /** Rows handed to successive awaited queries. */
  queue: [] as unknown[],
  writes: [] as { op: string; args: unknown[] }[],
}));

/** A drizzle-ish chain: every call returns the chain, awaiting it yields the next queued result. */
function chain(): unknown {
  const p: unknown = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve(h.queue.shift() ?? []);
      return (...args: unknown[]) => {
        h.writes.push({ op: String(prop), args });
        return p;
      };
    },
    apply: () => p,
  });
  return p;
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/rbac", () => ({
  requireRole: h.requireRole,
  requireStaff: async () => ({ userId: "u1", role: "owner", tenantSlug: "acme" }),
  AuthError: class AuthError extends Error {
    code: string;
    constructor(code: string, message?: string) {
      super(message ?? code);
      this.name = "AuthError";
      this.code = code;
    }
  },
}));
vi.mock("@/lib/tenant/context", () => ({ getTenantSlug: async () => "acme" }));
vi.mock("@/lib/tenant/modules", () => ({ assertModule: h.assertModule }));
vi.mock("@/lib/terms/server", () => ({
  getT: async (ns: string) => (key: string, values?: Record<string, string>) => {
    let node: unknown = (messages as Record<string, unknown>)[ns];
    for (const part of key.split(".")) node = (node as Record<string, unknown> | undefined)?.[part];
    return String(node).replace(/\{(\w+)\}/g, (m, k) => values?.[k] ?? m);
  },
}));
vi.mock("@/lib/db/tenant", () => ({ withTenantDb: async (_s: string, cb: (db: unknown, t: unknown) => unknown) => cb(chain(), chain()) }));
vi.mock("@/lib/queue/line", () => ({ claimEntry: h.claimEntry, beginService: h.beginService, endService: h.endService }));
vi.mock("@/lib/queue/board", () => ({ loadQueueBoard: h.loadQueueBoard }));
vi.mock("@/lib/sms/send", () => ({ sendSms: h.sendSms }));
vi.mock("@/lib/utils/after", () => ({ runAfterResponse: (fn: () => Promise<unknown>) => void fn() }));
vi.mock("@/lib/clients/for-tenant", () => ({ findClientByPhoneForTenant: vi.fn(), createClientForTenant: vi.fn() }));
vi.mock("@/lib/sms/consent", () => ({ recordSmsConsent: vi.fn() }));
vi.mock("@/actions/booking-public", () => ({ getBusinessBySlug: async () => ({ name: "Acme Salon" }) }));

import {
  addWalkIn,
  callEntry,
  callNext,
  createKioskLink,
  finishService,
  getQueueBoard,
  markLeft,
  setQueueOpen,
  startService,
  updateQueueSettings,
} from "./queue";

const STAFF_ROLES = ["owner", "admin", "provider", "assistant"];
const ADMIN_ROLES = ["owner", "admin"];

beforeEach(() => {
  vi.clearAllMocks();
  h.queue = [];
  h.writes = [];
  h.requireRole.mockResolvedValue({ userId: "u1", role: "owner", tenantSlug: "acme" });
  h.assertModule.mockResolvedValue(undefined);
  h.sendSms.mockResolvedValue({ success: true });
  h.loadQueueBoard.mockResolvedValue({ textOnJoin: false });
});

const claimed = (phone: string | null) => ({
  status: "ok" as const,
  entry: { id: ENTRY, name: "Pat", phone, clientId: "c1", assignedStaffId: STAFF, assignedStaffName: "Sam" },
});

describe("roles and the module gate", () => {
  const staffActions: [string, () => Promise<unknown>][] = [
    ["getQueueBoard", () => getQueueBoard(null).catch(() => undefined)],
    ["addWalkIn", () => addWalkIn({ locationId: null, name: "", phone: null, serviceId: null, preferredStaffId: null, smsConsent: false })],
    ["callNext", () => callNext({ locationId: null, staffId: STAFF })],
    ["callEntry", () => callEntry({ entryId: ENTRY, staffId: STAFF })],
    ["startService", () => startService({ entryId: ENTRY })],
    ["finishService", () => finishService({ entryId: ENTRY })],
    ["markLeft", () => markLeft({ entryId: ENTRY })],
  ];
  it.each(staffActions)("%s lets every team role in and checks the module", async (_name, run) => {
    h.claimEntry.mockResolvedValue({ status: "empty", staffName: "Sam" });
    h.beginService.mockResolvedValue({ status: "stale" });
    h.endService.mockResolvedValue(null);
    await run();
    expect(h.requireRole).toHaveBeenCalledWith(...STAFF_ROLES);
    expect(h.assertModule).toHaveBeenCalledWith("acme", "walk_in_queue");
  });

  const settingsActions: [string, () => Promise<unknown>][] = [
    ["setQueueOpen", () => setQueueOpen(true)],
    ["updateQueueSettings", () => updateQueueSettings({ maxWaiting: 20, textOnJoin: true })],
    ["createKioskLink", () => createKioskLink()],
  ];
  it.each(settingsActions)("%s is for owners and admins only and checks the module", async (_name, run) => {
    await run();
    expect(h.requireRole).toHaveBeenCalledWith(...ADMIN_ROLES);
    expect(h.assertModule).toHaveBeenCalledWith("acme", "walk_in_queue");
  });

  it("does nothing when the module is off", async () => {
    h.assertModule.mockRejectedValue(new Error("off"));
    await expect(callNext({ locationId: null, staffId: STAFF })).rejects.toThrow("off");
    expect(h.claimEntry).not.toHaveBeenCalled();
  });
});

describe("calling", () => {
  it("returns empty when no one fits", async () => {
    h.claimEntry.mockResolvedValue({ status: "empty", staffName: "Sam" });
    expect(await callNext({ locationId: null, staffId: STAFF })).toEqual({ success: true, empty: true });
    expect(h.sendSms).not.toHaveBeenCalled();
  });

  it("texts the person after the call", async () => {
    h.claimEntry.mockResolvedValue(claimed("+15555550142"));
    const res = await callNext({ locationId: null, staffId: STAFF });
    expect(res).toMatchObject({ success: true, entry: { id: ENTRY, assignedStaffName: "Sam" } });
    expect(h.sendSms).toHaveBeenCalledWith(
      expect.objectContaining({ to: "+15555550142", tenantSlug: "acme", messageType: "queue_called" }),
    );
    expect(h.sendSms.mock.calls[0][0].body).toContain("Sam is ready for you");
  });

  it("does not text a person with no phone", async () => {
    h.claimEntry.mockResolvedValue(claimed(null));
    await callNext({ locationId: null, staffId: STAFF });
    expect(h.sendSms).not.toHaveBeenCalled();
  });

  it("still succeeds when the text fails", async () => {
    h.claimEntry.mockResolvedValue(claimed("+15555550142"));
    h.sendSms.mockRejectedValue(new Error("twilio down"));
    const res = await callNext({ locationId: null, staffId: STAFF });
    expect(res).toMatchObject({ success: true });
  });

  it("says when the person is no longer waiting", async () => {
    h.claimEntry.mockResolvedValue({ status: "stale", staffName: "Sam" });
    const res = await callEntry({ entryId: ENTRY, staffId: STAFF });
    expect(res).toEqual({ success: false, error: messages.errors.queue.stale });
  });

  it("names the staff member who does not offer the service", async () => {
    h.claimEntry.mockResolvedValue({ status: "no_service", staffName: "Sam" });
    const res = await callEntry({ entryId: ENTRY, staffId: STAFF });
    expect(res).toMatchObject({ success: false });
    expect((res as { error: string }).error).toContain("Sam doesn't offer that");
  });

  it("rejects ids that are not uuids without touching the database", async () => {
    const res = await callNext({ locationId: null, staffId: "nope" });
    expect(res.success).toBe(false);
    expect(h.claimEntry).not.toHaveBeenCalled();
  });
});

describe("starting and finishing", () => {
  it("maps a failed booking to the busy message", async () => {
    h.beginService.mockResolvedValue({ status: "busy", staffName: "Sam" });
    const res = await startService({ entryId: ENTRY });
    expect(res).toMatchObject({ success: false });
    expect((res as { error: string }).error).toMatch(/^Sam has a .+ right now\.$/);
  });

  it("asks for a service when none is set", async () => {
    h.beginService.mockResolvedValue({ status: "need_service" });
    const res = await startService({ entryId: ENTRY });
    expect((res as { error: string }).error).toMatch(/^Choose a .+ before starting\.$/);
  });

  it("returns the appointment id", async () => {
    h.beginService.mockResolvedValue({ status: "ok", appointmentId: "appt-1" });
    expect(await startService({ entryId: ENTRY })).toEqual({ success: true, appointmentId: "appt-1" });
    h.endService.mockResolvedValue({ appointmentId: "appt-1" });
    expect(await finishService({ entryId: ENTRY })).toEqual({ success: true, appointmentId: "appt-1" });
  });
});

describe("settings", () => {
  it("refuses a line size outside 1 to 200 without writing", async () => {
    for (const maxWaiting of [0, 201, 1.5]) {
      const res = await updateQueueSettings({ maxWaiting, textOnJoin: false });
      expect(res.success).toBe(false);
    }
    expect(h.writes).toHaveLength(0);
  });

  it("updates the settings row, and inserts one when there is none", async () => {
    h.queue = [[]]; // update matched no row
    await setQueueOpen(true);
    expect(h.writes.map((w) => w.op)).toContain("insert");
  });

  it("returns a kiosk link that holds the token once", async () => {
    const res = await createKioskLink();
    expect(res.url).toMatch(/\/q\/acme\/kiosk\?k=[A-Za-z0-9_-]{32}$/);
  });
});
