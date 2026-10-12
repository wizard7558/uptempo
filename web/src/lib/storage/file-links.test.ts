import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signFileLink, verifyFileLink } from "./file-links";

const ID = "11111111-1111-4111-8111-111111111111";

function parts(link: string) {
  const u = new URL(link, "http://x");
  return { e: u.searchParams.get("e"), s: u.searchParams.get("s") };
}

beforeEach(() => vi.stubEnv("BOOKING_SESSION_SECRET", "test-secret"));
afterEach(() => vi.unstubAllEnvs());

describe("file links", () => {
  it("builds a tenant-scoped path and verifies", () => {
    const link = signFileLink("acme", ID);
    expect(link.startsWith(`/api/attachments/acme/${ID}?e=`)).toBe(true);
    const { e, s } = parts(link);
    expect(verifyFileLink("acme", ID, e, s)).toBe(true);
  });

  it("rejects a tampered signature, expiry, slug or id", () => {
    const { e, s } = parts(signFileLink("acme", ID));
    const flipped = (s![0] === "A" ? "B" : "A") + s!.slice(1);
    expect(verifyFileLink("acme", ID, e, flipped)).toBe(false);
    expect(verifyFileLink("acme", ID, String(Number(e) + 1000), s)).toBe(false);
    expect(verifyFileLink("other", ID, e, s)).toBe(false);
    expect(verifyFileLink("acme", ID.replace(/1$/, "2"), e, s)).toBe(false);
  });

  it("rejects missing or malformed parts", () => {
    expect(verifyFileLink("acme", ID, null, null)).toBe(false);
    expect(verifyFileLink("acme", ID, "abc", "x")).toBe(false);
  });

  it("expires after the ttl (default 300 seconds)", () => {
    const now = Date.now();
    const { e, s } = parts(signFileLink("acme", ID, 300, now));
    expect(verifyFileLink("acme", ID, e, s, now + 299_000)).toBe(true);
    expect(verifyFileLink("acme", ID, e, s, now + 301_000)).toBe(false);
  });

  it("uses FILE_LINK_SECRET when set", () => {
    const { e, s } = parts(signFileLink("acme", ID));
    vi.stubEnv("FILE_LINK_SECRET", "different");
    expect(verifyFileLink("acme", ID, e, s)).toBe(false);
  });
});
