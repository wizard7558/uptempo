export type ScoreBookingColorMode = "light" | "dark";

export type ScoreFixtureEnvironment = Record<string, string | undefined>;

export interface ScoreFixtureConfiguration {
  databaseUrl: string;
  colorMode: ScoreBookingColorMode;
}

export function scoreBookingColorMode(value: string | undefined): ScoreBookingColorMode {
  const mode = value ?? "light";
  if (mode !== "light" && mode !== "dark") {
    throw new Error("SCORE_BOOKING_COLOR_MODE must be light or dark");
  }
  return mode;
}

export function validateScoreFixtureEnvironment(
  environment: ScoreFixtureEnvironment,
): ScoreFixtureConfiguration {
  const colorMode = scoreBookingColorMode(environment.SCORE_BOOKING_COLOR_MODE);
  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Score fixtures require an isolated local test database");
  }

  let database: URL;
  try {
    database = new URL(databaseUrl);
  } catch {
    throw new Error("Score fixtures require an isolated local test database");
  }

  if (database.protocol !== "postgres:" && database.protocol !== "postgresql:") {
    throw new Error("Score fixtures require an isolated local test database");
  }

  const hostname = database.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(hostname);
  const port = database.port || "5432";
  let databaseName: string;
  try {
    databaseName = decodeURIComponent(database.pathname.replace(/^\/+/, ""));
  } catch {
    throw new Error("Score fixtures require an isolated local test database");
  }

  const isGithubActionsFixture =
    environment.CI === "true" &&
    environment.GITHUB_ACTIONS === "true" &&
    port === "5432" &&
    ["uptempo_test", "uptempo_production_test"].includes(databaseName);
  const isTaskLocalFixture =
    port !== "5432" && /^uptempo_score_[A-Za-z0-9_-]+$/.test(databaseName);

  if (!isLoopback || (!isGithubActionsFixture && !isTaskLocalFixture)) {
    throw new Error("Score fixtures require an isolated local test database");
  }

  return { databaseUrl, colorMode };
}
