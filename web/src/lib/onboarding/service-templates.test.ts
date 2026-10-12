import { describe, it, expect } from "vitest";
import { templateToServiceRow, type ServiceTemplate } from "./service-templates";

const base: ServiceTemplate = {
  id: "t1",
  name: "Bootcamp",
  defaultDurationMinutes: 45,
  priceCents: 2000,
  category: "other",
};

describe("templateToServiceRow", () => {
  it("maps a class template to is_class 1 and its capacity", () => {
    const row = templateToServiceRow({ ...base, isClass: true, capacity: 12 });
    expect(row.isClass).toBe(1);
    expect(row.classCapacity).toBe(12);
    expect(row).toMatchObject({ name: "Bootcamp", defaultDurationMinutes: 45, priceCents: 2000 });
  });

  it("maps a plain template to is_class 0 and no capacity", () => {
    const row = templateToServiceRow(base);
    expect(row.isClass).toBe(0);
    expect(row.classCapacity).toBeNull();
  });
});
