import { describe, expect, it } from "vitest";
import {
  resolveDomainMapProviderId,
  resolveDomainsProviderId,
  resolveEmailProviderId,
  resolveSmsProviderId,
  resolveStorageProviderId,
} from "./env";

describe("resolveStorageProviderId", () => {
  it.each([
    [{}, "local"],
    [{ BLOB_READ_WRITE_TOKEN: "tok" }, "vercel-blob"],
    [{ BLOB_READ_WRITE_TOKEN: "  " }, "local"],
    [{ STORAGE_PROVIDER: "s3", BLOB_READ_WRITE_TOKEN: "tok" }, "s3"],
    [{ STORAGE_PROVIDER: "LOCAL", BLOB_READ_WRITE_TOKEN: "tok" }, "local"],
    [{ STORAGE_PROVIDER: "vercel-blob" }, "vercel-blob"],
    [{ STORAGE_PROVIDER: "" }, "local"],
  ])("%j -> %s", (env, want) => {
    expect(resolveStorageProviderId(env)).toBe(want);
  });
  it("rejects invalid values", () => {
    expect(() => resolveStorageProviderId({ STORAGE_PROVIDER: "gcs" })).toThrow(
      "STORAGE_PROVIDER must be one of vercel-blob|local|s3",
    );
  });
});

describe("resolveEmailProviderId", () => {
  it.each([
    [{}, "console"],
    [{ RESEND_API_KEY: "re_live_123" }, "resend"],
    [{ RESEND_API_KEY: "re_placeholder" }, "console"],
    [{ RESEND_API_KEY: "test" }, "console"],
    [{ RESEND_API_KEY: "your-resend-api-key" }, "console"],
    [{ RESEND_API_KEY: "re_live_123", SMTP_HOST: "smtp.x" }, "resend"],
    [{ RESEND_API_KEY: "test", SMTP_HOST: "smtp.x" }, "smtp"],
    [{ SMTP_HOST: "smtp.x" }, "smtp"],
    [{ EMAIL_PROVIDER: "console", RESEND_API_KEY: "re_live_123" }, "console"],
    [{ EMAIL_PROVIDER: "smtp" }, "smtp"],
    [{ EMAIL_PROVIDER: "resend" }, "resend"],
  ])("%j -> %s", (env, want) => {
    expect(resolveEmailProviderId(env)).toBe(want);
  });
  it("rejects invalid values", () => {
    expect(() => resolveEmailProviderId({ EMAIL_PROVIDER: "ses" })).toThrow(
      "EMAIL_PROVIDER must be one of resend|smtp|console",
    );
  });
});

describe("resolveSmsProviderId", () => {
  it.each([
    [{}, "none"],
    [{ TWILIO_ACCOUNT_SID: "AC1" }, "twilio"],
    [{ SMS_PROVIDER: "loopmessage", TWILIO_ACCOUNT_SID: "AC1" }, "loopmessage"],
    [{ SMS_PROVIDER: "none", TWILIO_ACCOUNT_SID: "AC1" }, "none"],
    [{ SMS_PROVIDER: "twilio" }, "twilio"],
  ])("%j -> %s", (env, want) => {
    expect(resolveSmsProviderId(env)).toBe(want);
  });
  it("rejects invalid values", () => {
    expect(() => resolveSmsProviderId({ SMS_PROVIDER: "x" })).toThrow(
      "SMS_PROVIDER must be one of twilio|loopmessage|none",
    );
  });
});

describe("resolveDomainsProviderId", () => {
  const vercel = { VERCEL_TOKEN: "t", VERCEL_PROJECT_ID: "p" };
  it("is none in single mode regardless of env", () => {
    expect(resolveDomainsProviderId({ ...vercel, DOMAINS_PROVIDER: "vercel" }, "single")).toBe("none");
  });
  it.each([
    [{}, "none"],
    [vercel, "vercel"],
    [{ VERCEL_TOKEN: "t" }, "none"],
    [{ ...vercel, DOMAINS_PROVIDER: "none" }, "none"],
    [{ DOMAINS_PROVIDER: "vercel" }, "vercel"],
  ])("multi %j -> %s", (env, want) => {
    expect(resolveDomainsProviderId(env, "multi")).toBe(want);
  });
  it("rejects invalid values", () => {
    expect(() => resolveDomainsProviderId({ DOMAINS_PROVIDER: "x" }, "multi")).toThrow(
      "DOMAINS_PROVIDER must be one of vercel|none",
    );
  });
});

describe("resolveDomainMapProviderId", () => {
  it("is none in single mode regardless of env", () => {
    expect(resolveDomainMapProviderId({ GLOBAL_CONFIG: "x", DOMAIN_MAP_PROVIDER: "static" }, "single")).toBe("none");
  });
  it.each([
    [{}, "none"],
    [{ GLOBAL_CONFIG: "https://edge-config" }, "global-config"],
    [{ EDGE_CONFIG: "https://edge-config" }, "global-config"],
    [{ UPTEMPO_DOMAIN_MAP: "a.com=a" }, "static"],
    [{ GLOBAL_CONFIG: "x", UPTEMPO_DOMAIN_MAP: "a.com=a" }, "global-config"],
    [{ GLOBAL_CONFIG: "x", DOMAIN_MAP_PROVIDER: "static" }, "static"],
    [{ GLOBAL_CONFIG: "x", DOMAIN_MAP_PROVIDER: "none" }, "none"],
  ])("multi %j -> %s", (env, want) => {
    expect(resolveDomainMapProviderId(env, "multi")).toBe(want);
  });
  it("rejects invalid values", () => {
    expect(() => resolveDomainMapProviderId({ DOMAIN_MAP_PROVIDER: "x" }, "multi")).toThrow(
      "DOMAIN_MAP_PROVIDER must be one of global-config|static|none",
    );
  });
});
