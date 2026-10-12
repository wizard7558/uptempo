// @vitest-environment node
import { describe, it, expect } from "vitest";


import { normalizePostal, lookupPostalCentroid, parseCentroidCsv } from "./postal";

describe("normalizePostal", () => {
  it("keeps the first 5 digits for US codes", () => {
    expect(normalizePostal("10001-1234")).toBe("10001");
    expect(normalizePostal(" 10001 ")).toBe("10001");
  });
  it("uppercases and strips spaces for other countries", () => {
    expect(normalizePostal("k1a 0b1", "CA")).toBe("K1A0B1");
  });
});

describe("lookupPostalCentroid", () => {
  it("finds a known ZIP", async () => {
    const p = await lookupPostalCentroid("10001");
    expect(p).not.toBeNull();
    expect(Math.abs(p!.lat - 40.75)).toBeLessThan(0.05);
    expect(Math.abs(p!.lng - -73.997)).toBeLessThan(0.05);
  });
  it("accepts ZIP+4", async () => {
    expect(await lookupPostalCentroid("10001-1234")).not.toBeNull();
  });
  it("returns null for unknown, malformed and non-US codes", async () => {
    expect(await lookupPostalCentroid("00000")).toBeNull();
    expect(await lookupPostalCentroid("abc")).toBeNull();
    expect(await lookupPostalCentroid("K1A0B1", "CA")).toBeNull();
  });
});

describe("parseCentroidCsv", () => {
  it("skips the header and blank lines", () => {
    const m = parseCentroidCsv("zip,lat,lng\n10001,40.75065,-73.99730\n\n");
    expect(m.size).toBe(1);
    expect(m.get("10001")).toEqual({ lat: 40.75065, lng: -73.9973 });
  });
});
