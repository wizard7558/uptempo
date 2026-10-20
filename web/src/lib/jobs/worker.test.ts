import { afterEach, describe, expect, it, vi } from "vitest";
import { runWorker, type WorkerOptions } from "./worker";

type Query = { text: string; values: unknown[] };

function createSql(decide: (text: string, values: unknown[]) => unknown[]) {
  const queries: Query[] = [];
  const call = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("$");
    queries.push({ text, values });
    return Promise.resolve(decide(text, values));
  };
  const reserved = Object.assign(call, {
    release() {
      queries.push({ text: "release", values: [] });
    },
  });
  const sql = Object.assign(call, {
    async reserve() {
      queries.push({ text: "reserve", values: [] });
      return reserved;
    },
    async end() {
      queries.push({ text: "end", values: [] });
    },
  });
  return { sql: sql as WorkerOptions["sql"], queries };
}

const fetches: { url: string; init: RequestInit | undefined }[] = [];
const fetchImpl: typeof fetch = async (input, init) => {
  fetches.push({ url: String(input), init });
  return new Response("ok", { status: 200 });
};

async function tickAt(isoJustBefore: string, sql: WorkerOptions["sql"]) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(isoJustBefore));
  const worker = runWorker({
    targetUrl: "http://web:3000",
    cronSecret: "secret",
    databaseUrl: "postgres://unused",
    fetchImpl,
    sql,
  });
  await vi.advanceTimersByTimeAsync(1_000);
  await worker.stop();
  vi.useRealTimers();
}

afterEach(() => {
  fetches.length = 0;
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("runWorker", () => {
  it("claims a slot before it takes the advisory lock", async () => {
    const { sql, queries } = createSql((text, values) => {
      if (text.includes("INSERT")) return [{ job_id: values[0] }];
      if (text.includes("pg_try_advisory_lock")) return [{ locked: true }];
      return [];
    });
    await tickAt("2026-10-11T12:06:59.000Z", sql);

    const texts = queries.map((query) => query.text);
    const insertAt = texts.findIndex((text) => text.includes("INSERT INTO job_runs"));
    const reserveAt = texts.indexOf("reserve");
    const lockAt = texts.findIndex((text) => text.includes("pg_try_advisory_lock"));
    expect(texts[insertAt]).toContain("ON CONFLICT DO NOTHING");
    expect(reserveAt).toBeGreaterThan(insertAt);
    expect(lockAt).toBeGreaterThan(reserveAt);
    expect(fetches.map((call) => call.url)).toEqual(["http://web:3000/api/calendar/sync"]);
    expect(fetches[0]?.init?.headers).toEqual({ Authorization: "Bearer secret" });
    expect(queries.some((query) => query.values.includes("ok"))).toBe(true);
  });

  it("skips the fetch when another worker already claimed the slot", async () => {
    const { sql, queries } = createSql((text) => (text.includes("INSERT") ? [] : []));
    await tickAt("2026-10-11T12:06:59.000Z", sql);
    expect(fetches).toEqual([]);
    expect(queries.some((query) => query.text === "reserve")).toBe(false);
  });

  it("marks skipped_overlap and does not fetch when the lock is held", async () => {
    const { sql, queries } = createSql((text, values) => {
      if (text.includes("INSERT")) return [{ job_id: values[0] }];
      if (text.includes("pg_try_advisory_lock")) return [{ locked: false }];
      return [];
    });
    await tickAt("2026-10-11T12:06:59.000Z", sql);
    expect(fetches).toEqual([]);
    expect(queries.some((query) => query.values.includes("skipped_overlap"))).toBe(true);
    expect(queries.some((query) => query.text.includes("pg_advisory_unlock"))).toBe(false);
    expect(queries.some((query) => query.text === "release")).toBe(true);
  });

  it("filters jobs the install cannot run", async () => {
    vi.stubEnv("UPTEMPO_MODE", "single");
    vi.stubEnv("SMS_PROVIDER", "none");
    vi.stubEnv("APNS_KEY_ID", "");
    vi.stubEnv("APNS_TEAM_ID", "");
    vi.stubEnv("APNS_PRIVATE_KEY", "");
    const { sql, queries } = createSql((text, values) => {
      if (text.includes("INSERT")) return [{ job_id: values[0] }];
      if (text.includes("pg_try_advisory_lock")) return [{ locked: true }];
      return [];
    });
    await tickAt("2026-10-01T05:59:59.000Z", sql);
    const claimed = queries
      .filter((query) => query.text.includes("INSERT INTO job_runs"))
      .map((query) => query.values[0]);
    expect(claimed).toEqual([
      "calendar-sync",
      "calendar-retry-push",
      "send-reminders",
      "waitlist-offers",
    ]);
  });

  it("runs sms and push jobs when those requirements are met", async () => {
    vi.stubEnv("UPTEMPO_MODE", "multi");
    vi.stubEnv("SMS_PROVIDER", "twilio");
    vi.stubEnv("APNS_KEY_ID", "key");
    vi.stubEnv("APNS_TEAM_ID", "team");
    vi.stubEnv("APNS_PRIVATE_KEY", "pem");
    const { sql, queries } = createSql((text, values) => {
      if (text.includes("INSERT")) return [{ job_id: values[0] }];
      if (text.includes("pg_try_advisory_lock")) return [{ locked: true }];
      return [];
    });
    await tickAt("2026-10-01T05:59:59.000Z", sql);
    const claimed = queries
      .filter((query) => query.text.includes("INSERT INTO job_runs"))
      .map((query) => query.values[0]);
    expect(claimed).toEqual([
      "calendar-sync",
      "calendar-retry-push",
      "send-reminders",
      "send-sms-reminders",
      "send-push-reminders",
      "waitlist-offers",
      "sync-sms-registrations",
    ]);
  });

  it("runs the billing switch at 14:00 UTC in multi mode only", async () => {
    vi.stubEnv("UPTEMPO_MODE", "multi");
    vi.stubEnv("SMS_PROVIDER", "none");
    const { sql, queries } = createSql((text, values) => {
      if (text.includes("INSERT")) return [{ job_id: values[0] }];
      if (text.includes("pg_try_advisory_lock")) return [{ locked: true }];
      return [];
    });
    await tickAt("2026-10-11T13:59:59.000Z", sql);
    const claimed = queries
      .filter((query) => query.text.includes("INSERT INTO job_runs"))
      .map((query) => query.values[0]);
    expect(claimed).toContain("switch-billing");
    expect(fetches.map((call) => call.url)).toContain(
      "http://web:3000/api/cron/switch-billing",
    );

    fetches.length = 0;
    vi.stubEnv("UPTEMPO_MODE", "single");
    const single = createSql((text, values) => {
      if (text.includes("INSERT")) return [{ job_id: values[0] }];
      if (text.includes("pg_try_advisory_lock")) return [{ locked: true }];
      return [];
    });
    await tickAt("2026-10-11T13:59:59.000Z", single.sql);
    const singleClaimed = single.queries
      .filter((query) => query.text.includes("INSERT INTO job_runs"))
      .map((query) => query.values[0]);
    expect(singleClaimed).not.toContain("switch-billing");
    expect(fetches.map((call) => call.url)).not.toContain(
      "http://web:3000/api/cron/switch-billing",
    );
  });
});
