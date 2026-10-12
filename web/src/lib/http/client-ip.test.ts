import { describe, expect, it } from "vitest";
import { clientIpFrom } from "./client-ip";

describe("clientIpFrom", () => {
  it("uses the first x-forwarded-for entry, trimmed", () => {
    const h = new Headers({ "x-forwarded-for": " 1.2.3.4 , 5.6.7.8", "x-real-ip": "9.9.9.9" });
    expect(clientIpFrom(h)).toBe("1.2.3.4");
  });
  it("falls back to x-real-ip", () => {
    expect(clientIpFrom(new Headers({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
  });
  it("falls back to unknown", () => {
    expect(clientIpFrom(new Headers())).toBe("unknown");
  });
});
