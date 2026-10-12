// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const SESSION = "11111111-1111-4111-8111-111111111111";
const ENROLL = "22222222-2222-4222-8222-222222222222";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const SVC = "44444444-4444-4444-8444-444444444444";
const STAFF = "55555555-5555-4555-8555-555555555555";

const h = vi.hoisted(() => {
  class ModuleDisabledError extends Error {}
  return {
    ModuleDisabledError,
    requireRole: vi.fn(),
    assertModule: vi.fn(),
    getActorStaffId: vi.fn(),
    enrollInClass: vi.fn(),
    cancelEnrollment: vi.fn(),
    setSessionCapacity: vi.fn(),
    cancelSession: vi.fn(),
    createClassSessions: vi.fn(),
    hasModule: vi.fn(),
    findRedeemablePackage: vi.fn(),
    /** Rows handed to successive awaited queries. */
    queue: [] as unknown[],
    writes: [] as string[],
  };
});

function chain(): unknown {
  const p: unknown = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve(h.queue.shift() ?? []);
      return () => p;
    },
    apply: () => p,
  });
  return p;
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/rbac", () => ({
  requireRole: h.requireRole,
  requireStaff: async () => ({ userId: "u1", role: "owner", tenantSlug: "gym" }),
  AuthError: class AuthError extends Error {
    code: string;
    constructor(code: string, message?: string) {
      super(message ?? code);
      this.name = "AuthError";
      this.code = code;
    }
  },
}));
vi.mock("@/lib/auth/actor-staff", () => ({ getActorStaffId: h.getActorStaffId }));
vi.mock("@/lib/tenant/context", () => ({ getTenantSlug: async () => "gym" }));
vi.mock("@/lib/tenant/modules", () => ({
  assertModule: h.assertModule,
  hasModule: h.hasModule,
  ModuleDisabledError: h.ModuleDisabledError,
}));
vi.mock("@/lib/terms/server", () => ({ getT: async () => (key: string) => key }));
vi.mock("@/lib/scheduling/load", () => ({ loadSchedulingSettings: async () => ({ timezone: "UTC" }) }));
vi.mock("@/lib/credits/ledger", () => ({ findRedeemablePackage: h.findRedeemablePackage }));
vi.mock("@/lib/classes/enroll", () => ({
  enrollInClass: h.enrollInClass,
  cancelEnrollment: h.cancelEnrollment,
  setSessionCapacity: h.setSessionCapacity,
  cancelSession: h.cancelSession,
  createClassSessions: h.createClassSessions,
}));
vi.mock("@/lib/db/tenant", () => ({
  withTenantDb: async (_slug: string, fn: (db: unknown, t: unknown) => unknown) => {
    const tables = new Proxy({}, { get: () => new Proxy({}, { get: (_t, c) => String(c) }) });
    const writer = (kind: string) => () => {
      h.writes.push(kind);
      return chain();
    };
    return fn({ select: () => chain(), update: writer("update"), insert: writer("insert") }, tables);
  },
}));

import {
  addToClass,
  clientClassCredit,
  cancelClass,
  createClasses,
  getRoster,
  listClassWeek,
  markAttendance,
  staffCancelEnrollment,
  updateCapacity,
} from "./classes";

const sessionRow = (staffId: string) => ({
  id: SESSION,
  serviceId: SVC,
  className: "Bootcamp",
  staffId,
  staffName: "Jordan",
  locationId: null,
  during: { start: new Date("2030-01-07T10:00:00Z"), end: new Date("2030-01-07T10:45:00Z") },
  capacity: 5,
  waitlistCapacity: 2,
  status: "scheduled",
  seriesId: null,
  priceCents: null,
});

const as = (role: string, tenantSlug: string | null = "gym") =>
  h.requireRole.mockResolvedValue({ userId: "u1", role, tenantSlug });

const validCreate = {
  serviceId: SVC,
  staffId: STAFF,
  locationId: null,
  resourceId: null,
  date: "2030-01-07",
  startTime: "10:00",
  capacity: 8,
  waitlistCapacity: 2,
  priceCents: null,
  repeatWeeks: 4 as const,
  allowConflicts: false,
};

beforeEach(() => {
  for (const f of [h.requireRole, h.assertModule, h.getActorStaffId, h.enrollInClass, h.cancelEnrollment, h.setSessionCapacity, h.cancelSession, h.createClassSessions, h.hasModule, h.findRedeemablePackage]) {
    f.mockReset();
  }
  h.assertModule.mockResolvedValue(undefined);
  h.queue.length = 0;
  h.writes.length = 0;
  as("owner");
});

describe("role and module gating", () => {
  it("roster actions allow owner, admin, provider and assistant, and every action checks the classes module", async () => {
    const roster = ["owner", "admin", "provider", "assistant"];
    const calls: (() => Promise<unknown>)[] = [
      () => listClassWeek("2030-01-07"),
      () => getRoster(SESSION),
      () => addToClass(SESSION, CLIENT, false),
      () => staffCancelEnrollment(ENROLL, true),
      () => markAttendance(ENROLL, "attended"),
    ];
    for (const call of calls) {
      h.requireRole.mockClear();
      h.assertModule.mockClear();
      await call().catch(() => undefined);
      expect(h.requireRole).toHaveBeenCalledWith(...roster);
      expect(h.assertModule).toHaveBeenCalledWith("gym", "classes");
    }
  });

  it("capacity, cancel and create are for owner and admin only", async () => {
    for (const call of [
      () => updateCapacity(SESSION, 6),
      () => cancelClass(SESSION),
      () => createClasses(validCreate),
    ]) {
      h.requireRole.mockClear();
      h.assertModule.mockClear();
      await call().catch(() => undefined);
      expect(h.requireRole).toHaveBeenCalledWith("owner", "admin");
      expect(h.assertModule).toHaveBeenCalledWith("gym", "classes");
    }
  });

  it("with the module off, every write returns the sentence and touches nothing", async () => {
    h.assertModule.mockRejectedValue(new h.ModuleDisabledError("Classes is turned off."));
    const off = { success: false, error: "Classes is turned off." };
    expect(await getRoster(SESSION)).toEqual(off);
    expect(await addToClass(SESSION, CLIENT, true)).toEqual(off);
    expect(await staffCancelEnrollment(ENROLL, true)).toEqual(off);
    expect(await markAttendance(ENROLL, "no_show")).toEqual(off);
    expect(await updateCapacity(SESSION, 6)).toEqual(off);
    expect(await cancelClass(SESSION)).toEqual(off);
    expect(await createClasses(validCreate)).toEqual(off);
    expect(h.enrollInClass).not.toHaveBeenCalled();
    expect(h.cancelEnrollment).not.toHaveBeenCalled();
    expect(h.setSessionCapacity).not.toHaveBeenCalled();
    expect(h.cancelSession).not.toHaveBeenCalled();
    expect(h.createClassSessions).not.toHaveBeenCalled();
    expect(h.writes).toEqual([]);
  });

  it("the week list throws when the module is off (the page redirects first)", async () => {
    h.assertModule.mockRejectedValue(new h.ModuleDisabledError("off"));
    await expect(listClassWeek("2030-01-07")).rejects.toBeInstanceOf(h.ModuleDisabledError);
  });
});

describe("providers and assistants only manage their own sessions", () => {
  it("a provider cannot add to, cancel or mark another staff member's class", async () => {
    as("provider");
    h.getActorStaffId.mockResolvedValue("me");

    h.queue.push([sessionRow("someone-else")], []);
    expect(await addToClass(SESSION, CLIENT, false)).toEqual({ success: false, error: "errors.notYours" });

    h.queue.push([{ sessionId: SESSION }], [sessionRow("someone-else")], []);
    expect(await staffCancelEnrollment(ENROLL, true)).toEqual({ success: false, error: "errors.notYours" });

    h.queue.push([{ sessionId: SESSION }], [sessionRow("someone-else")], []);
    expect(await markAttendance(ENROLL, "attended")).toEqual({ success: false, error: "errors.notYours" });

    h.queue.push([sessionRow("someone-else")], []);
    expect(await getRoster(SESSION)).toEqual({ success: false, error: "errors.notYours" });

    expect(h.enrollInClass).not.toHaveBeenCalled();
    expect(h.cancelEnrollment).not.toHaveBeenCalled();
    expect(h.writes).toEqual([]);
  });

  it("a provider can add to and cancel in their own class, as staff", async () => {
    as("provider");
    h.getActorStaffId.mockResolvedValue("me");
    h.enrollInClass.mockResolvedValue({ status: "booked" });
    h.cancelEnrollment.mockResolvedValue({ promotedClientId: null });

    h.queue.push([sessionRow("me")], []);
    expect(await addToClass(SESSION, CLIENT, true)).toEqual({ success: true, status: "booked", position: undefined });
    expect(h.enrollInClass).toHaveBeenCalledWith("gym", { sessionId: SESSION, clientId: CLIENT, useCredit: true, actor: "staff" });

    h.queue.push([{ sessionId: SESSION }], [sessionRow("me")], []);
    expect(await staffCancelEnrollment(ENROLL, false)).toEqual({ success: true, promotedClientId: null });
    expect(h.cancelEnrollment).toHaveBeenCalledWith("gym", { enrollmentId: ENROLL, actor: "staff", refundCredit: false });
  });

  it("an assistant with no staff profile gets nothing", async () => {
    as("assistant");
    h.getActorStaffId.mockResolvedValue(null);
    h.queue.push([sessionRow("someone")], []);
    expect(await addToClass(SESSION, CLIENT, false)).toEqual({ success: false, error: "errors.notYours" });
  });

  it("an owner can manage any class and does not look up a staff profile", async () => {
    h.enrollInClass.mockResolvedValue({ status: "waitlisted", position: 2 });
    h.queue.push([sessionRow("anyone")], []);
    expect(await addToClass(SESSION, CLIENT, false)).toEqual({ success: true, status: "waitlisted", position: 2 });
    expect(h.getActorStaffId).not.toHaveBeenCalled();
  });

  it("turns an enrollment error into its sentence", async () => {
    h.enrollInClass.mockResolvedValue({ error: "ALREADY" });
    h.queue.push([sessionRow("anyone")], []);
    expect(await addToClass(SESSION, CLIENT, false)).toEqual({ success: false, error: "public.errors.ALREADY" });
  });
});

describe("attendance", () => {
  it("marks a booked spot, and refuses one that is not booked", async () => {
    h.queue.push([{ sessionId: SESSION }], [sessionRow(STAFF)], [], [{ id: ENROLL }]);
    expect(await markAttendance(ENROLL, "attended")).toEqual({ success: true });
    expect(h.writes).toEqual(["update"]);

    h.queue.push([{ sessionId: SESSION }], [sessionRow(STAFF)], [], []);
    expect(await markAttendance(ENROLL, "no_show")).toEqual({ success: false, error: "errors.notBooked" });
  });

  it("rejects an outcome other than attended or no_show", async () => {
    expect(await markAttendance(ENROLL, "cancelled" as "attended")).toEqual({ success: false, error: "errors.invalid" });
    expect(h.writes).toEqual([]);
  });
});

describe("owner actions", () => {
  it("passes capacity and cancel through to the engine", async () => {
    h.setSessionCapacity.mockResolvedValue({ success: true, promoted: 1 });
    h.cancelSession.mockResolvedValue({ success: true, notified: 3 });
    expect(await updateCapacity(SESSION, 9)).toEqual({ success: true, promoted: 1 });
    expect(h.setSessionCapacity).toHaveBeenCalledWith("gym", SESSION, 9);
    expect(await cancelClass(SESSION)).toEqual({ success: true, notified: 3 });
    expect(h.cancelSession).toHaveBeenCalledWith("gym", SESSION);
  });

  it("returns an engine refusal as the failure", async () => {
    h.setSessionCapacity.mockResolvedValue({ success: false, error: "too many booked" });
    expect(await updateCapacity(SESSION, 1)).toEqual({ success: false, error: "too many booked" });
  });

  it("createClasses checks its input, and returns conflicts for 'Save anyway'", async () => {
    expect(await createClasses({ ...validCreate, repeatWeeks: 5 as 4 })).toEqual({ success: false, error: "errors.invalid" });
    expect(await createClasses({ ...validCreate, capacity: 0 })).toEqual({ success: false, error: "errors.invalid" });
    expect(h.createClassSessions).not.toHaveBeenCalled();

    h.createClassSessions.mockResolvedValueOnce({ conflicts: [{ date: "2030-01-21", reason: "appointment" }] });
    expect(await createClasses(validCreate)).toEqual({
      success: false,
      conflicts: [{ date: "2030-01-21", reason: "appointment" }],
    });
    h.createClassSessions.mockResolvedValueOnce({ sessionIds: ["a", "b"] });
    expect(await createClasses({ ...validCreate, allowConflicts: true })).toEqual({ success: true, sessionIds: ["a", "b"] });
    expect(h.createClassSessions).toHaveBeenLastCalledWith("gym", { ...validCreate, allowConflicts: true });
  });
});

describe("clientClassCredit", () => {
  it("reports a usable credit for this class's service", async () => {
    h.hasModule.mockResolvedValue(true);
    h.findRedeemablePackage.mockResolvedValue({ id: "p1", name: "10 pack", creditsRemaining: 4 });
    h.queue.push([sessionRow("anyone")], []);
    expect(await clientClassCredit(SESSION, CLIENT)).toEqual({ hasCredit: true, name: "10 pack", remaining: 4 });
    expect(h.findRedeemablePackage.mock.calls[0][2]).toMatchObject({ clientId: CLIENT, serviceIds: [SVC], lock: false });
  });

  it("says no when the client has no pack, or packages are off", async () => {
    const none = { hasCredit: false, name: null, remaining: 0 };
    h.hasModule.mockResolvedValue(true);
    h.findRedeemablePackage.mockResolvedValue(null);
    h.queue.push([sessionRow("anyone")], []);
    expect(await clientClassCredit(SESSION, CLIENT)).toEqual(none);

    h.hasModule.mockResolvedValue(false);
    expect(await clientClassCredit(SESSION, CLIENT)).toEqual(none);
  });
});
