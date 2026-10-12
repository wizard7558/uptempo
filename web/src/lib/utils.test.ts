import { afterEach, describe, expect, it, vi } from "vitest";
import { getBaseUrl } from "./utils";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getBaseUrl", () => {
  it("prefers APP_URL, then NEXT_PUBLIC_APP_URL, then the Vercel production host", () => {
    vi.stubEnv("APP_URL", "https://book.example.com/");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://public.example.com");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "bookuptempo.com");
    expect(getBaseUrl()).toBe("https://book.example.com");

    vi.stubEnv("APP_URL", "");
    expect(getBaseUrl()).toBe("https://public.example.com");

    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(getBaseUrl()).toBe("https://bookuptempo.com");

    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    expect(getBaseUrl()).toBe("http://localhost:3000"); // pragma: allowlist secret
  });
});