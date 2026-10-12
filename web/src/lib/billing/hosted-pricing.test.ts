import { describe, expect, it } from "vitest";
import { extraStaffQuantity, hostedMonthlyCents } from "./hosted-pricing";

describe("hostedMonthlyCents", () => {
  it("charges $12 for one staff member and no texts", () => {
    expect(hostedMonthlyCents({ staff: 1, textLine: false, texts: 0 })).toBe(1200);
  });

  it("charges $33 for three staff, the text line, and 100 texts", () => {
    expect(hostedMonthlyCents({ staff: 3, textLine: true, texts: 100 })).toBe(3300);
  });

  it("charges $42 for nine staff and no texts", () => {
    expect(hostedMonthlyCents({ staff: 9, textLine: false, texts: 0 })).toBe(4200);
  });

  it("charges $12 when staff is zero", () => {
    expect(hostedMonthlyCents({ staff: 0, textLine: false, texts: 0 })).toBe(1200);
  });

  it("ignores texts when the line is off", () => {
    expect(hostedMonthlyCents({ staff: 1, textLine: false, texts: 100 })).toBe(1200);
  });
});

describe("extraStaffQuantity", () => {
  it("returns zero for zero or negative staff and caps at five", () => {
    expect(extraStaffQuantity(0)).toBe(0);
    expect(extraStaffQuantity(-3)).toBe(0);
    expect(extraStaffQuantity(9)).toBe(5);
  });
});
