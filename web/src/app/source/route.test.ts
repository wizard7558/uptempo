import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/source", () => {
  it("redirects to the default repository", () => {
    vi.stubEnv("UPTEMPO_SOURCE_URL", "");
    const res = GET();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://github.com/wizard7558/uptempo");
  });

  it("redirects to UPTEMPO_SOURCE_URL when set", () => {
    vi.stubEnv("UPTEMPO_SOURCE_URL", "https://example.com/fork");
    const res = GET();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://example.com/fork");
  });
});
