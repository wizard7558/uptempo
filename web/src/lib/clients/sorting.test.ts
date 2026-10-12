import { describe, expect, it } from "vitest";
import {
  clientsPageHref,
  getNextClientSortDirection,
  normalizeClientSort,
} from "@/lib/clients/sorting";

describe("normalizeClientSort", () => {
  it("falls back to the default sort when params are missing", () => {
    expect(normalizeClientSort()).toEqual({
      sortBy: "firstName",
      sortDir: "asc",
    });
  });

  it("accepts valid sort params", () => {
    expect(
      normalizeClientSort({
        sortBy: "appointmentsBooked",
        sortDir: "desc",
      }),
    ).toEqual({
      sortBy: "appointmentsBooked",
      sortDir: "desc",
    });
  });

  it("uses the first value when params arrive as arrays", () => {
    expect(
      normalizeClientSort({
        sortBy: ["email", "phone"],
        sortDir: ["desc", "asc"],
      }),
    ).toEqual({
      sortBy: "email",
      sortDir: "desc",
    });
  });
});

describe("getNextClientSortDirection", () => {
  it("toggles the direction for the active column", () => {
    expect(getNextClientSortDirection("email", "asc", "email")).toBe("desc");
    expect(getNextClientSortDirection("email", "desc", "email")).toBe("asc");
  });

  it("resets to ascending for a new column", () => {
    expect(getNextClientSortDirection("email", "desc", "phone")).toBe("asc");
  });
});

describe("clientsPageHref", () => {
  it("omits default sort params from the URL", () => {
    expect(clientsPageHref({ query: "Ada" })).toBe("/clients?q=Ada");
  });

  it("preserves pagination and non-default sort params", () => {
    expect(
      clientsPageHref({
        query: "Ada",
        page: 3,
        sortBy: "email",
        sortDir: "desc",
      }),
    ).toBe("/clients?q=Ada&page=3&sort=email&dir=desc");
  });

  it("keeps a custom-field filter in the URL", () => {
    expect(
      clientsPageHref({
        attributeKey: "hair_types",
        attributeValue: "blonde",
      }),
    ).toBe("/clients?f=hair_types&v=blonde");
  });
});
