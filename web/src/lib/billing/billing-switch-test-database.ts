import type postgres from "postgres";

export const BILLING_SWITCH_TEST_DATABASE_URL_ENV =
  "BILLING_SWITCH_TEST_DATABASE_URL";
export const BILLING_SWITCH_TEST_RUN_ID_ENV = "BILLING_SWITCH_TEST_RUN_ID";

export type BillingSwitchTestDatabaseConfig =
  | { enabled: false; reason: string }
  | {
      enabled: true;
      databaseUrl: string;
      databaseName: string;
      runId: string;
      marker: string;
    };

export function resolveBillingSwitchTestDatabaseConfig(
  env: Record<string, string | undefined>,
): BillingSwitchTestDatabaseConfig {
  const databaseUrl = env[BILLING_SWITCH_TEST_DATABASE_URL_ENV];
  const runId = env[BILLING_SWITCH_TEST_RUN_ID_ENV];

  if (databaseUrl === undefined && runId === undefined) {
    return {
      enabled: false,
      reason: `set both ${BILLING_SWITCH_TEST_DATABASE_URL_ENV} and ${BILLING_SWITCH_TEST_RUN_ID_ENV} to enable PostgreSQL cases`,
    };
  }
  if (!databaseUrl || !runId) {
    throw new Error(
      `Both ${BILLING_SWITCH_TEST_DATABASE_URL_ENV} and ${BILLING_SWITCH_TEST_RUN_ID_ENV} are required`,
    );
  }
  if (!/^[0-9a-f]{24}$/.test(runId)) {
    throw new Error(
      `${BILLING_SWITCH_TEST_RUN_ID_ENV} must be exactly 24 lowercase hexadecimal characters`,
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error(
      `${BILLING_SWITCH_TEST_DATABASE_URL_ENV} must be a valid PostgreSQL URL`,
    );
  }

  if (parsedUrl.protocol !== "postgres:" && parsedUrl.protocol !== "postgresql:") {
    throw new Error(
      `${BILLING_SWITCH_TEST_DATABASE_URL_ENV} must use postgres:// or postgresql://`,
    );
  }
  if (!parsedUrl.hostname || !parsedUrl.port) {
    throw new Error(
      `${BILLING_SWITCH_TEST_DATABASE_URL_ENV} must include an explicit loopback host and port`,
    );
  }
  const hostname = parsedUrl.hostname.toLowerCase();
  if (
    hostname !== "localhost" &&
    hostname !== "127.0.0.1" &&
    hostname !== "[::1]" &&
    hostname !== "::1"
  ) {
    throw new Error(
      `${BILLING_SWITCH_TEST_DATABASE_URL_ENV} host must be an explicit loopback address`,
    );
  }
  if (
    parsedUrl.search ||
    parsedUrl.hash ||
    databaseUrl.includes("?") ||
    databaseUrl.includes("#")
  ) {
    throw new Error(
      `${BILLING_SWITCH_TEST_DATABASE_URL_ENV} must not contain query parameters or a fragment`,
    );
  }

  const databaseName = `uptempo_billing_switch_test_${runId}`;
  if (parsedUrl.pathname !== `/${databaseName}`) {
    throw new Error(
      `${BILLING_SWITCH_TEST_DATABASE_URL_ENV} database name must be exactly ${databaseName}`,
    );
  }
  if (env.DATABASE_URL !== databaseUrl) {
    throw new Error(
      `DATABASE_URL must exactly match ${BILLING_SWITCH_TEST_DATABASE_URL_ENV}`,
    );
  }

  return {
    enabled: true,
    databaseUrl,
    databaseName,
    runId,
    marker: `uptempo-billing-switch-disposable:${runId}`,
  };
}

export async function assertBillingSwitchTestDatabase(
  sql: ReturnType<typeof postgres>,
  config: Extract<BillingSwitchTestDatabaseConfig, { enabled: true }>,
): Promise<void> {
  const [identity] = await sql`
    SELECT current_database() AS database_name,
           pg_catalog.shobj_description(database_row.oid, 'pg_database') AS marker
    FROM pg_catalog.pg_database AS database_row
    WHERE database_row.datname = current_database()
  `;
  if (
    identity?.database_name !== config.databaseName ||
    identity?.marker !== config.marker
  ) {
    throw new Error(
      `Refusing billing integration test mutation: expected database ${config.databaseName} with marker ${config.marker}`,
    );
  }
}
