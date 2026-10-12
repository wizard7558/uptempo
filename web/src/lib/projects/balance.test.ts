import { describe, expect, it } from "vitest";
import { computeProjectBalance, type ProjectCharge } from "./balance";

const deposit = (amountCents = 20000, status = "completed"): ProjectCharge => ({
  reason: "deposit",
  status,
  amountCents,
  tipCents: null,
  depositAppliedCents: 0,
});
const payment = (amountCents: number, depositAppliedCents = 0, tipCents: number | null = null): ProjectCharge => ({
  reason: "service_payment",
  status: "completed",
  amountCents,
  tipCents,
  depositAppliedCents,
});

describe("computeProjectBalance", () => {
  const QUOTED = 120000;

  it("after session 1: paid 60000, balance 60000, credit 20000", () => {
    const b = computeProjectBalance(QUOTED, [deposit(), payment(40000)]);
    expect(b.paidCents).toBe(60000);
    expect(b.balanceCents).toBe(60000);
    expect(b.depositCreditCents).toBe(20000);
  });

  it("after session 2: paid 100000, balance 20000, credit 20000", () => {
    const b = computeProjectBalance(QUOTED, [deposit(), payment(40000), payment(40000)]);
    expect(b.paidCents).toBe(100000);
    expect(b.balanceCents).toBe(20000);
    expect(b.depositCreditCents).toBe(20000);
  });

  it("after session 3 (deposit applied): paid 120000, balance 0, credit 0", () => {
    const b = computeProjectBalance(QUOTED, [deposit(), payment(40000), payment(40000), payment(40000, 20000)]);
    expect(b).toMatchObject({
      billedCents: 120000,
      depositsCents: 20000,
      appliedCents: 20000,
      paidCents: 120000,
      balanceCents: 0,
      depositCreditCents: 0,
    });
  });

  it("ignores a failed deposit", () => {
    const b = computeProjectBalance(QUOTED, [deposit(20000, "failed"), payment(40000)]);
    expect(b.depositsCents).toBe(0);
    expect(b.paidCents).toBe(40000);
    expect(b.depositCreditCents).toBe(0);
  });

  it("ignores a failed or pending service payment", () => {
    const failed: ProjectCharge = { ...payment(40000), status: "failed" };
    expect(computeProjectBalance(QUOTED, [failed]).paidCents).toBe(0);
  });

  it("a tip does not change the balance", () => {
    const withTip = computeProjectBalance(QUOTED, [deposit(), payment(41500, 0, 1500)]);
    const without = computeProjectBalance(QUOTED, [deposit(), payment(40000)]);
    expect(withTip).toEqual(without);
  });

  it("has no balance without a quoted total", () => {
    expect(computeProjectBalance(null, [deposit()]).balanceCents).toBeNull();
  });
});
