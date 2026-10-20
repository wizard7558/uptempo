import postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import {
  BILLING_SWITCH_TEST_DATABASE_URL_ENV,
  BILLING_SWITCH_TEST_RUN_ID_ENV,
  assertBillingSwitchTestDatabase,
  resolveBillingSwitchTestDatabaseConfig,
} from "./billing-switch-test-database";

describe("billing switch disposable database guards", () => {
  const runId = "0123456789abcdef01234567";
  const databaseName = `uptempo_billing_switch_test_${runId}`;
  const validUrl = `postgresql://postgres:postgres@127.0.0.1:55432/${databaseName}`;

  it("does not opt in from DATABASE_URL alone", () => {
    expect(
      resolveBillingSwitchTestDatabaseConfig({
        DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/uptempo",
      }),
    ).toMatchObject({
      enabled: false,
      reason: expect.stringContaining(BILLING_SWITCH_TEST_DATABASE_URL_ENV),
    });
  });

  it("accepts only the nonce-named loopback database with both explicit opt-in values", () => {
    expect(
      resolveBillingSwitchTestDatabaseConfig({
        DATABASE_URL: validUrl,
        [BILLING_SWITCH_TEST_DATABASE_URL_ENV]: validUrl,
        [BILLING_SWITCH_TEST_RUN_ID_ENV]: runId,
      }),
    ).toMatchObject({
      enabled: true,
      databaseName,
      runId,
      marker: `uptempo-billing-switch-disposable:${runId}`,
    });
  });

  it("rejects partial opt-in, malformed run ids, wrong names, remote hosts, and URL parameters", () => {
    expect(() =>
      resolveBillingSwitchTestDatabaseConfig({
        [BILLING_SWITCH_TEST_DATABASE_URL_ENV]: validUrl,
      }),
    ).toThrow(/Both .* are required/);
    expect(() =>
      resolveBillingSwitchTestDatabaseConfig({
        [BILLING_SWITCH_TEST_RUN_ID_ENV]: runId,
      }),
    ).toThrow(/Both .* are required/);
    expect(() =>
      resolveBillingSwitchTestDatabaseConfig({
        [BILLING_SWITCH_TEST_DATABASE_URL_ENV]: validUrl,
        [BILLING_SWITCH_TEST_RUN_ID_ENV]: runId.toUpperCase(),
      }),
    ).toThrow(/24 lowercase hexadecimal/);
    expect(() =>
      resolveBillingSwitchTestDatabaseConfig({
        [BILLING_SWITCH_TEST_DATABASE_URL_ENV]: validUrl.replace(
          "127.0.0.1",
          "example.com",
        ),
        [BILLING_SWITCH_TEST_RUN_ID_ENV]: runId,
      }),
    ).toThrow(/loopback/);
    expect(() =>
      resolveBillingSwitchTestDatabaseConfig({
        [BILLING_SWITCH_TEST_DATABASE_URL_ENV]: validUrl.replace(
          `/${databaseName}`,
          "/uptempo",
        ),
        [BILLING_SWITCH_TEST_RUN_ID_ENV]: runId,
      }),
    ).toThrow(/database name must be exactly/);
    expect(() =>
      resolveBillingSwitchTestDatabaseConfig({
        [BILLING_SWITCH_TEST_DATABASE_URL_ENV]: `${validUrl}?sslmode=require`,
        [BILLING_SWITCH_TEST_RUN_ID_ENV]: runId,
      }),
    ).toThrow(/query parameters/);
  });

  it("requires the ordinary DATABASE_URL to be explicitly pinned to the opted-in database", () => {
    const optIn = {
      [BILLING_SWITCH_TEST_DATABASE_URL_ENV]: validUrl,
      [BILLING_SWITCH_TEST_RUN_ID_ENV]: runId,
    };
    expect(() => resolveBillingSwitchTestDatabaseConfig(optIn)).toThrow(
      /DATABASE_URL must exactly match/,
    );
    expect(() =>
      resolveBillingSwitchTestDatabaseConfig({
        ...optIn,
        DATABASE_URL: validUrl.replace(databaseName, "uptempo"),
      }),
    ).toThrow(/DATABASE_URL must exactly match/);
  });

  it("refuses missing or mismatched ownership markers", async () => {
    const config = resolveBillingSwitchTestDatabaseConfig({
      DATABASE_URL: validUrl,
      [BILLING_SWITCH_TEST_DATABASE_URL_ENV]: validUrl,
      [BILLING_SWITCH_TEST_RUN_ID_ENV]: runId,
    });
    if (!config.enabled) throw new Error("valid test database config was disabled");

    for (const identity of [
      { database_name: databaseName, marker: null },
      { database_name: "uptempo", marker: config.marker },
      { database_name: databaseName, marker: "unrelated-database" },
    ]) {
      const fakeSql = vi.fn(async () => [identity]) as unknown as ReturnType<
        typeof postgres
      >;
      await expect(assertBillingSwitchTestDatabase(fakeSql, config)).rejects.toThrow(
        /Refusing billing integration test mutation/,
      );
      expect(fakeSql).toHaveBeenCalledOnce();
    }
  });
});
