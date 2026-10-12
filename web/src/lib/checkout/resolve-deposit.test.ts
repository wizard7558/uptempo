import { describe, expect, it } from "vitest";
import { resolveDepositToApply } from "./checkout-set";

const project = { id: "p1", depositCreditCents: 20000, isLastScheduled: false };

describe("resolveDepositToApply", () => {
  it("outside a project it is the deposits collected on the set, whatever the flag", () => {
    const set = { depositPaidCents: 1000, project: null };
    expect(resolveDepositToApply(set)).toBe(1000);
    expect(resolveDepositToApply(set, false)).toBe(1000);
    expect(resolveDepositToApply(set, true)).toBe(1000);
    expect(resolveDepositToApply({ depositPaidCents: 0, project: null })).toBe(0);
  });

  it("inside a project no deposit applies unless this is marked the final session", () => {
    const set = { depositPaidCents: 20000, project };
    expect(resolveDepositToApply(set)).toBe(0);
    expect(resolveDepositToApply(set, false)).toBe(0);
  });

  it("on the final session the whole unapplied project credit applies", () => {
    expect(resolveDepositToApply({ depositPaidCents: 0, project }, true)).toBe(20000);
    expect(resolveDepositToApply({ depositPaidCents: 0, project: { ...project, depositCreditCents: 0 } }, true)).toBe(0);
  });
});
