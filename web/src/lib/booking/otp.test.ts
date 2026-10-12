import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { verifyCodeForTenant } from "./otp";

// The review-mode path must return before any DB access; the fallback path
// hits the tenant DB, which we stub to "no record found".
vi.mock("@/lib/db/tenant", () => ({
  withTenantDb: vi.fn(async () => ({ valid: false })),
}));

vi.mock("@/lib/tenant/context", () => ({
  getTenantSlug: vi.fn(async () => "demo"),
}));

import { withTenantDb } from "@/lib/db/tenant";

describe("review-mode OTP (REVIEW_OTP_EMAIL / REVIEW_OTP_CODE)", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.REVIEW_OTP_EMAIL;
    delete process.env.REVIEW_OTP_CODE;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("is disabled when env vars are not set", async () => {
    const result = await verifyCodeForTenant(
      "demo",
      "reviewer@example.com",
      "123456",
    );
    expect(result).toEqual({ valid: false });
    expect(withTenantDb).toHaveBeenCalled();
  });

  it("accepts the static code for the review identifier without touching the DB", async () => {
    process.env.REVIEW_OTP_EMAIL = "reviewer@example.com";
    process.env.REVIEW_OTP_CODE = "123456";

    const result = await verifyCodeForTenant(
      "demo",
      "reviewer@example.com",
      "123456",
    );
    expect(result).toEqual({ valid: true, type: "email" });
    expect(withTenantDb).not.toHaveBeenCalled();
  });

  it("matches the review email case-insensitively and trimmed", async () => {
    process.env.REVIEW_OTP_EMAIL = "Reviewer@Example.com";
    process.env.REVIEW_OTP_CODE = "123456";

    const result = await verifyCodeForTenant(
      "demo",
      "  reviewer@example.COM ",
      "123456",
    );
    expect(result).toEqual({ valid: true, type: "email" });
  });

  it("rejects a wrong static code for the review identifier", async () => {
    process.env.REVIEW_OTP_EMAIL = "reviewer@example.com";
    process.env.REVIEW_OTP_CODE = "123456";

    const result = await verifyCodeForTenant(
      "demo",
      "reviewer@example.com",
      "654321",
    );
    expect(result).toEqual({ valid: false });
  });

  it("does not apply the static code to other identifiers", async () => {
    process.env.REVIEW_OTP_EMAIL = "reviewer@example.com";
    process.env.REVIEW_OTP_CODE = "123456";

    const result = await verifyCodeForTenant(
      "demo",
      "someone-else@example.com",
      "123456",
    );
    expect(result).toEqual({ valid: false });
    expect(withTenantDb).toHaveBeenCalled();
  });
});
