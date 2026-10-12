import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const script = path.resolve("scripts/check-local-bootstrap.mjs");

function run(env) {
  return spawnSync(process.execPath, [script, "--env-only"], {
    env,
    encoding: "utf8",
  });
}

const singleReady = {
  UPTEMPO_MODE: "single",
  DATABASE_URL: "postgres://uptempo:pw@db:5432/uptempo",
  APP_URL: "http://127.0.0.1:3000",
  BETTER_AUTH_SECRET: "a".repeat(32),
  BETTER_AUTH_URL: "http://127.0.0.1:3000",
  BOOKING_SESSION_SECRET: "b".repeat(32),
  CRON_SECRET: "c".repeat(32),
  UPTEMPO_WORKER_TARGET_URL: "http://web:3000",
};

describe("check-local-bootstrap --env-only", () => {
  it("lists every missing single-mode required var", () => {
    const result = run({ UPTEMPO_MODE: "single" });
    expect(result.status).toBe(1);
    const text = result.stderr;
    for (const name of [
      "DATABASE_URL",
      "APP_URL",
      "BETTER_AUTH_SECRET",
      "BETTER_AUTH_URL",
      "BOOKING_SESSION_SECRET",
      "CRON_SECRET",
      "UPTEMPO_WORKER_TARGET_URL",
    ]) {
      expect(text).toContain(`- ${name} (core): required`);
    }
  });

  it("lists a missing multi-mode required var with its group", () => {
    const result = run({ UPTEMPO_MODE: "multi" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("- DATABASE_URL (core): required");
  });

  it("requires SMTP settings when EMAIL_PROVIDER=smtp", () => {
    const result = run({ ...singleReady, EMAIL_PROVIDER: "smtp" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "- SMTP_HOST (email): required because EMAIL_PROVIDER=smtp",
    );
  });

  it("rejects a bad provider enum and names the var", () => {
    const result = run({ ...singleReady, SMS_PROVIDER: "pigeon" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "- SMS_PROVIDER (sms): must be one of twilio|loopmessage|none|log",
    );
  });

  it("rejects DATABASE_SHARD_URLS that is not JSON", () => {
    const result = run({ ...singleReady, DATABASE_SHARD_URLS: "s2" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("- DATABASE_SHARD_URLS (core): must be JSON");
  });
});
