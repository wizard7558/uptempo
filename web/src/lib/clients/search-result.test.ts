import { describe, it, expect } from "vitest";
import { toClientSearchResult } from "./search-result";

describe("toClientSearchResult", () => {
  it("uses email as the subtitle when present", () => {
    expect(
      toClientSearchResult({
        id: "c1",
        name: "Ada Lovelace",
        email: "ada@example.com",
        phone: "+15551234567",
      }),
    ).toEqual({ id: "c1", name: "Ada Lovelace", subtitle: "ada@example.com" });
  });

  it("falls back to phone when email is missing", () => {
    expect(
      toClientSearchResult({
        id: "c2",
        name: "Grace Hopper",
        email: null,
        phone: "+15559876543",
      }),
    ).toEqual({ id: "c2", name: "Grace Hopper", subtitle: "+15559876543" });
  });

  it("falls back to phone when email is blank whitespace", () => {
    expect(
      toClientSearchResult({
        id: "c3",
        name: "Blank Email",
        email: "   ",
        phone: "+15550001111",
      }).subtitle,
    ).toBe("+15550001111");
  });

  it("returns an empty subtitle when neither email nor phone exist", () => {
    expect(
      toClientSearchResult({
        id: "c4",
        name: "No Contact",
        email: null,
        phone: null,
      }),
    ).toEqual({ id: "c4", name: "No Contact", subtitle: "" });
  });

  it("trims surrounding whitespace from the chosen subtitle", () => {
    expect(
      toClientSearchResult({
        id: "c5",
        name: "Padded",
        email: "  padded@example.com  ",
        phone: null,
      }).subtitle,
    ).toBe("padded@example.com");
  });
});
