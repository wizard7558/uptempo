import { describe, expect, it } from "vitest";
import { scoreBookingColorMode, validateScoreFixtureEnvironment } from "./score-e2e-fixture";

const localDatabase = "postgresql://user:secret@127.0.0.1:59137/uptempo_score_7a2c";

describe("Score E2E fixture safety", () => {
  it("defaults booking fixtures to light and accepts a task-local database", () => {
    expect(validateScoreFixtureEnvironment({ DATABASE_URL: localDatabase })).toEqual({
      databaseUrl: localDatabase,
      colorMode: "light",
    });
  });

  it("accepts an explicit dark theme for the task-local database", () => {
    expect(
      validateScoreFixtureEnvironment({
        DATABASE_URL: localDatabase,
        SCORE_BOOKING_COLOR_MODE: "dark",
      }).colorMode,
    ).toBe("dark");
  });

  it("rejects an invalid supplied theme", () => {
    expect(() => scoreBookingColorMode("system")).toThrow("SCORE_BOOKING_COLOR_MODE must be light or dark");
    expect(() => scoreBookingColorMode("")).toThrow("SCORE_BOOKING_COLOR_MODE must be light or dark");
  });

  it.each(["uptempo_test", "uptempo_production_test"])(
    "accepts the exact loopback GitHub Actions fixture %s on port 5432",
    (databaseName) => {
      const databaseUrl = `postgresql://postgres:postgres@localhost:5432/${databaseName}`;
      expect(
        validateScoreFixtureEnvironment({
          DATABASE_URL: databaseUrl,
          CI: "true",
          GITHUB_ACTIONS: "true",
        }).databaseUrl,
      ).toBe(databaseUrl);
    },
  );

  it("rejects port 5432 unless the exact GitHub Actions fixture is selected", () => {
    const databaseUrl = "postgresql://postgres:postgres@localhost:5432/uptempo_test";
    for (const environment of [
      { DATABASE_URL: databaseUrl },
      { DATABASE_URL: databaseUrl, CI: "true" },
      { DATABASE_URL: databaseUrl, GITHUB_ACTIONS: "true" },
      { DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/other_test", CI: "true", GITHUB_ACTIONS: "true" },
    ]) {
      expect(() => validateScoreFixtureEnvironment(environment)).toThrow(
        "Score fixtures require an isolated local test database",
      );
    }
  });

  it("rejects a default port, an unowned database name, and non-loopback hosts", () => {
    for (const databaseUrl of [
      "postgresql://user:secret@localhost/uptempo_score_7a2c",
      "postgresql://user:secret@localhost:59137/uptempo_test",
      "postgresql://user:secret@db.example.test:59137/uptempo_score_7a2c",
    ]) {
      expect(() => validateScoreFixtureEnvironment({ DATABASE_URL: databaseUrl })).toThrow(
        "Score fixtures require an isolated local test database",
      );
    }
  });

  it("does not disclose database credentials in guard failures", () => {
    expect(() =>
      validateScoreFixtureEnvironment({
        DATABASE_URL: "postgresql://private-user:private-secret@remote.invalid:5432/live_db",
      }),
    ).toThrow("Score fixtures require an isolated local test database");
  });
});
