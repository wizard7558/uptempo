import { afterEach, describe, expect, it, vi } from "vitest";
import { getUptempoMode, isSingleMode } from "./mode";

afterEach(() => vi.unstubAllEnvs());

describe("getUptempoMode", () => {
  it("defaults to multi when unset or empty", () => {
    vi.stubEnv("UPTEMPO_MODE", "");
    expect(getUptempoMode()).toBe("multi");
    expect(isSingleMode()).toBe(false);
  });
  it("accepts multi and single, trimmed and case-insensitive", () => {
    vi.stubEnv("UPTEMPO_MODE", " MULTI ");
    expect(getUptempoMode()).toBe("multi");
    vi.stubEnv("UPTEMPO_MODE", "Single");
    expect(getUptempoMode()).toBe("single");
    expect(isSingleMode()).toBe(true);
  });
  it("throws on an invalid value", () => {
    vi.stubEnv("UPTEMPO_MODE", "both");
    expect(() => getUptempoMode()).toThrow(/UPTEMPO_MODE must be "multi" or "single" \(got "both"\)/);
  });
});
