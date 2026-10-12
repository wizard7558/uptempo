import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import {
  isApnsConfigured,
  bundleIdForOwnerType,
  buildApnsAuthToken,
  sendApnsNotifications,
} from "./apns";

const ENV_KEYS = [
  "APNS_KEY_ID",
  "APNS_TEAM_ID",
  "APNS_PRIVATE_KEY",
  "APNS_BUNDLE_ID_CLIENT",
  "APNS_BUNDLE_ID_OWNER",
];

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

describe("apns config", () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  it("is not configured without key vars", () => {
    expect(isApnsConfigured()).toBe(false);
  });

  it("no-ops (succeeds) when unconfigured, without network", async () => {
    const results = await sendApnsNotifications(
      [{ apnsToken: "abc", environment: "production" }],
      { title: "t", body: "b" },
      "com.uptempo.client",
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ ok: true, shouldRevoke: false });
  });

  it("resolves bundle id by owner type", () => {
    process.env.APNS_BUNDLE_ID_CLIENT = "com.uptempo.client";
    process.env.APNS_BUNDLE_ID_OWNER = "com.uptempo.owner";
    expect(bundleIdForOwnerType("client")).toBe("com.uptempo.client");
    expect(bundleIdForOwnerType("user")).toBe("com.uptempo.owner");
  });
});

describe("apns auth token (ES256 JWT)", () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  it("produces a JWT that verifies against the EC public key", () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    process.env.APNS_KEY_ID = "KEY123";
    process.env.APNS_TEAM_ID = "TEAM456";
    process.env.APNS_PRIVATE_KEY = privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();

    const token = buildApnsAuthToken();
    const [header, payload, signature] = token.split(".");

    const decodedHeader = JSON.parse(
      Buffer.from(header, "base64url").toString("utf8"),
    );
    const decodedPayload = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    expect(decodedHeader).toMatchObject({ alg: "ES256", kid: "KEY123" });
    expect(decodedPayload.iss).toBe("TEAM456");
    expect(typeof decodedPayload.iat).toBe("number");

    const ok = crypto.verify(
      "SHA256",
      Buffer.from(`${header}.${payload}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    );
    expect(ok).toBe(true);
  });
});
