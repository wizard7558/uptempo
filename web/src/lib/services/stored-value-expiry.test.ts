import { describe, it, expect } from "vitest";
import { computeExpirableCents, type LedgerEntry } from "./stored-value-expiry";

// Helper: day N as epoch ms (arbitrary base).
const DAY = 24 * 60 * 60 * 1000;
const day = (n: number) => n * DAY;

describe("computeExpirableCents", () => {
  it("expires an old credit lot with no later debits", () => {
    const entries: LedgerEntry[] = [
      { amountCents: 5000, createdAtMs: day(1) }, // old
    ];
    // cutoff after day 1 → the whole lot is expired
    expect(computeExpirableCents(entries, day(30))).toBe(5000);
  });

  it("does not expire credits newer than the cutoff", () => {
    const entries: LedgerEntry[] = [
      { amountCents: 5000, createdAtMs: day(40) }, // newer than cutoff
    ];
    expect(computeExpirableCents(entries, day(30))).toBe(0);
  });

  it("consumes oldest credits first (FIFO) so debits protect new credits", () => {
    const entries: LedgerEntry[] = [
      { amountCents: 5000, createdAtMs: day(1) }, // old
      { amountCents: 5000, createdAtMs: day(40) }, // new
      { amountCents: -3000, createdAtMs: day(45) }, // spends oldest first
    ];
    // Old lot has 2000 remaining (5000 - 3000) and is before cutoff → expirable.
    // New lot (5000) is after cutoff → not expirable.
    expect(computeExpirableCents(entries, day(30))).toBe(2000);
  });

  it("returns 0 when debits fully consumed the old lot", () => {
    const entries: LedgerEntry[] = [
      { amountCents: 5000, createdAtMs: day(1) },
      { amountCents: -5000, createdAtMs: day(10) },
    ];
    expect(computeExpirableCents(entries, day(30))).toBe(0);
  });

  it("sums multiple old lots", () => {
    const entries: LedgerEntry[] = [
      { amountCents: 1000, createdAtMs: day(1) },
      { amountCents: 2000, createdAtMs: day(5) },
      { amountCents: 4000, createdAtMs: day(50) }, // newer than cutoff
    ];
    expect(computeExpirableCents(entries, day(30))).toBe(3000);
  });

  it("is order-independent and idempotent after an expiry debit", () => {
    const entries: LedgerEntry[] = [
      { amountCents: 5000, createdAtMs: day(1) },
      { amountCents: 5000, createdAtMs: day(40) },
    ];
    const expirable = computeExpirableCents(entries, day(30));
    expect(expirable).toBe(5000);
    // Apply the expiry debit, then re-run: now nothing more is expirable.
    const after = [
      ...entries,
      { amountCents: -expirable, createdAtMs: day(31) },
    ];
    expect(computeExpirableCents(after, day(30))).toBe(0);
  });

  it("handles an empty ledger", () => {
    expect(computeExpirableCents([], day(30))).toBe(0);
  });
});
