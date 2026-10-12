// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ refundEntry: vi.fn(), queue: [] as unknown[][] }));
vi.mock("@/lib/credits/ledger", () => ({ refundEntry: h.refundEntry }));

import { isOnTimeCancel, refundCreditIfOnTime } from "./cancel";

const HOUR = 3_600_000;
const start = new Date("2026-07-01T15:00:00Z");

describe("isOnTimeCancel", () => {
  it("is on time well before the window", () => {
    expect(isOnTimeCancel(start, new Date(start.getTime() - 48 * HOUR), 24)).toBe(true);
  });
  it("is late inside the window", () => {
    expect(isOnTimeCancel(start, new Date(start.getTime() - 2 * HOUR), 24)).toBe(false);
  });
  it("exactly at the window edge is late; one millisecond earlier is on time", () => {
    expect(isOnTimeCancel(start, new Date(start.getTime() - 24 * HOUR), 24)).toBe(false);
    expect(isOnTimeCancel(start, new Date(start.getTime() - 24 * HOUR - 1), 24)).toBe(true);
  });
  it("is late once the visit has started", () => {
    expect(isOnTimeCancel(start, new Date(start.getTime() + HOUR), 24)).toBe(false);
  });
  it("a zero-hour window is on time until the start", () => {
    expect(isOnTimeCancel(start, new Date(start.getTime() - 1), 0)).toBe(true);
    expect(isOnTimeCancel(start, start, 0)).toBe(false);
  });
});

/** A transaction whose successive selects return the queued row lists. */
function fakeTx() {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "from", "where"]) chain[m] = () => chain;
  chain.limit = async () => h.queue.shift() ?? [];
  return chain as never;
}
const tables = {
  appointments: { creditEntryId: "ce", during: "during", id: "id" },
  creditLedger: { reason: "reason", id: "id" },
  businessSettings: { cancellationWindowHours: "h" },
} as never;
vi.mock("drizzle-orm", async (orig) => ({ ...(await orig<typeof import("drizzle-orm")>()), eq: () => ({}) }));

describe("refundCreditIfOnTime", () => {
  beforeEach(() => {
    h.refundEntry.mockReset();
    h.queue = [];
  });
  const during = { start, end: new Date(start.getTime() + HOUR) };
  const run = (now: Date, hours?: number, ignoreWindow = false) =>
    refundCreditIfOnTime(fakeTx(), tables, { appointmentId: "a1", now, cancellationWindowHours: hours, ignoreWindow });

  it("does nothing without a credit", async () => {
    h.queue = [[{ creditEntryId: null, during }]];
    expect(await run(new Date(start.getTime() - 48 * HOUR), 24)).toBe(false);
    expect(h.refundEntry).not.toHaveBeenCalled();
  });

  it("refunds a redeemed credit when the cancel is on time", async () => {
    h.queue = [[{ creditEntryId: "L1", during }], [{ reason: "redeem" }]];
    expect(await run(new Date(start.getTime() - 48 * HOUR), 24)).toBe(true);
    expect(h.refundEntry).toHaveBeenCalledWith(expect.anything(), tables, "L1", "refund");
  });

  it("burns the credit on a late cancel and exactly at the edge", async () => {
    h.queue = [[{ creditEntryId: "L1", during }], [{ reason: "redeem" }]];
    expect(await run(new Date(start.getTime() - 2 * HOUR), 24)).toBe(false);
    h.queue = [[{ creditEntryId: "L1", during }], [{ reason: "redeem" }]];
    expect(await run(new Date(start.getTime() - 24 * HOUR), 24)).toBe(false);
    expect(h.refundEntry).not.toHaveBeenCalled();
  });

  it("never gives back a late_cancel credit", async () => {
    h.queue = [[{ creditEntryId: "L1", during }], [{ reason: "late_cancel" }]];
    expect(await run(new Date(start.getTime() - 48 * HOUR), 24)).toBe(false);
    expect(h.refundEntry).not.toHaveBeenCalled();
  });

  it("reads the window from the business settings when it is not passed", async () => {
    // 12 h window: a cancel 18 h ahead is on time, with no window argument.
    h.queue = [[{ creditEntryId: "L1", during }], [{ reason: "redeem" }], [{ hours: 12 }]];
    expect(await run(new Date(start.getTime() - 18 * HOUR))).toBe(true);
  });

  it("ignoreWindow refunds even after the visit started", async () => {
    h.queue = [[{ creditEntryId: "L1", during }], [{ reason: "redeem" }]];
    expect(await run(new Date(start.getTime() + HOUR), undefined, true)).toBe(true);
    expect(h.refundEntry).toHaveBeenCalledTimes(1);
  });
});
