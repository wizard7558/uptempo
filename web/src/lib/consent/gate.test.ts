// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasModule: vi.fn(),
  loadSchedulingSettings: vi.fn(),
  /** Results of the select() calls, in order. */
  selects: [] as unknown[][],
  updates: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/tenant/modules", () => ({ hasModule: mocks.hasModule }));
vi.mock("@/lib/scheduling/load", () => ({ loadSchedulingSettings: mocks.loadSchedulingSettings }));
vi.mock("@/lib/db/tenant", () => {
  // A chainable stand-in for the query builder: any chain resolves to the next queued result.
  const chain = (result: () => unknown): unknown =>
    new Proxy(() => undefined, {
      get: (_t, prop) => {
        if (prop === "then") {
          const value = result();
          return (resolve: (v: unknown) => void) => resolve(value);
        }
        return () => chain(result);
      },
    });
  const db = {
    select: () => chain(() => mocks.selects.shift() ?? []),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        mocks.updates.push(values);
        return chain(() => []);
      },
    }),
  };
  const col = new Proxy({}, { get: (_t, name) => String(name) });
  const tables = new Proxy({}, { get: () => col });
  return { withTenantDb: async (_slug: string, fn: (d: unknown, t: unknown) => unknown) => fn(db, tables) };
});

import { enforceAgeGate, getAgeGate } from "./gate";

// 2026-06-17 noon in New York.
const START = new Date("2026-06-17T16:00:00Z");
const GATE_ROW = { kind: "consent", minAge: 18, isActive: 1, requiresId: 0 };

beforeEach(() => {
  mocks.selects.length = 0;
  mocks.updates.length = 0;
  mocks.hasModule.mockReset().mockResolvedValue(true);
  mocks.loadSchedulingSettings.mockReset().mockResolvedValue({ timezone: "America/New_York" });
});

const run = (over: Partial<Parameters<typeof enforceAgeGate>[1]> = {}) =>
  enforceAgeGate("acme", { clientId: "c1", serviceIds: ["s1"], start: START, strict: true, ...over });

describe("getAgeGate", () => {
  it("is null when the module is off, without querying", async () => {
    mocks.hasModule.mockResolvedValue(false);
    expect(await getAgeGate("acme", ["s1"])).toBeNull();
  });

  it("is null when no assigned consent form sets a minimum age", async () => {
    mocks.selects.push([{ ...GATE_ROW, minAge: null }]);
    expect(await getAgeGate("acme", ["s1"])).toBeNull();
  });

  it("takes the largest minimum age and reports whether any form wants an ID", async () => {
    mocks.selects.push([GATE_ROW, { ...GATE_ROW, minAge: 21, requiresId: 1 }]);
    expect(await getAgeGate("acme", ["s1"])).toEqual({ minAge: 21, requiresId: true });
  });
});

describe("enforceAgeGate", () => {
  it("is ok when there is no gate", async () => {
    mocks.selects.push([]);
    expect(await run()).toEqual({ ok: true });
  });

  it("asks for a date of birth on strict paths when none is known", async () => {
    mocks.selects.push([GATE_ROW], [{ birthday: null }]);
    expect(await run()).toEqual({ ok: false, code: "DOB_REQUIRED", minAge: 18 });
  });

  it("lets staff through when no birthday is known (strict false)", async () => {
    mocks.selects.push([GATE_ROW], [{ birthday: null }]);
    expect(await run({ strict: false })).toEqual({ ok: true });
  });

  it("refuses an underage birthday on file, counting on the local day of the appointment", async () => {
    mocks.selects.push([GATE_ROW], [{ birthday: "2008-06-18" }]);
    expect(await run()).toEqual({ ok: false, code: "UNDERAGE", minAge: 18 });
  });

  it("accepts someone who turns 18 on the appointment day", async () => {
    mocks.selects.push([GATE_ROW], [{ birthday: "2008-06-17" }]);
    expect(await run()).toEqual({ ok: true });
  });

  it("uses the business time zone, not UTC, for the day", async () => {
    // 2026-06-18 01:00 UTC is still June 17 in New York: a June 18 birthday is not 18 yet.
    mocks.selects.push([GATE_ROW], [{ birthday: "2008-06-18" }]);
    expect(await run({ start: new Date("2026-06-18T01:00:00Z") })).toMatchObject({ ok: false, code: "UNDERAGE" });
  });

  it("saves a typed birthday when none is on file", async () => {
    mocks.selects.push([GATE_ROW], [{ birthday: null }]);
    expect(await run({ dobInput: "2000-01-01" })).toEqual({ ok: true });
    expect(mocks.updates).toEqual([expect.objectContaining({ birthday: "2000-01-01" })]);
  });

  it("refuses an underage typed birthday and still keeps it", async () => {
    mocks.selects.push([GATE_ROW], [{ birthday: null }]);
    expect(await run({ dobInput: "2010-01-01" })).toMatchObject({ ok: false, code: "UNDERAGE" });
    expect(mocks.updates).toHaveLength(1);
  });

  it("ignores a typed birthday when one is on file", async () => {
    mocks.selects.push([GATE_ROW], [{ birthday: "2000-01-01" }]);
    expect(await run({ dobInput: "2015-01-01" })).toEqual({ ok: true });
    expect(mocks.updates).toHaveLength(0);
  });

  it("treats a garbage or future date as missing", async () => {
    for (const dobInput of ["not-a-date", "2999-01-01", "2001-02-30"]) {
      mocks.selects.push([GATE_ROW], [{ birthday: null }]);
      expect(await run({ dobInput })).toEqual({ ok: false, code: "DOB_REQUIRED", minAge: 18 });
    }
    expect(mocks.updates).toHaveLength(0);
  });
});
