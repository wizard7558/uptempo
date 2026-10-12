import { describe, it, expect } from "vitest";
import {
  createExpenseSchema,
  expenseFiltersSchema,
  updateExpenseSchema,
} from "./expense";

describe("createExpenseSchema", () => {
  it("accepts valid payload", () => {
    const r = createExpenseSchema.safeParse({
      expenseDate: "2026-04-01",
      vendorName: "Sally Beauty",
      category: "color",
      amountCents: 12500,
    });
    expect(r.success).toBe(true);
  });

  it("rejects bad date format", () => {
    const r = createExpenseSchema.safeParse({
      expenseDate: "04/01/2026",
      vendorName: "X",
      category: "color",
      amountCents: 100,
    });
    expect(r.success).toBe(false);
  });
});

describe("expenseFiltersSchema", () => {
  it("accepts empty filters", () => {
    expect(expenseFiltersSchema.safeParse({}).success).toBe(true);
  });

  it("accepts category all", () => {
    expect(
      expenseFiltersSchema.safeParse({ category: "all" }).success,
    ).toBe(true);
  });
});

describe("updateExpenseSchema", () => {
  it("requires uuid id", () => {
    const r = updateExpenseSchema.safeParse({
      id: "not-uuid",
      expenseDate: "2026-04-01",
      vendorName: "X",
      category: "retail",
      amountCents: 1,
    });
    expect(r.success).toBe(false);
  });
});
