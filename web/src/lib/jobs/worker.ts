import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { getUptempoMode } from "../config/mode";
import { readProviderEnv, resolveSmsProviderId } from "../providers/env";
import { matchesCron } from "./cron";
import { JOBS, type JobDefinition } from "./registry";

type Query = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Array<Record<string, unknown>>>;

type Reserved = Query & { release(): void };

type SqlClient = Query & {
  reserve(): Promise<Reserved>;
  end(options?: { timeout?: number }): Promise<void>;
};

export type WorkerOptions = {
  targetUrl: string;
  cronSecret: string;
  databaseUrl: string;
  now?: () => Date;
  fetchImpl?: typeof fetch;
  sql?: SqlClient;
  scheduler?: WorkerScheduler;
};

/** Typed timer seam for deterministic acceptance runs; production uses native timers. */
export type WorkerScheduler = {
  schedule(callback: () => void, delayMs: number): { cancel(): void };
};

const nativeScheduler: WorkerScheduler = {
  schedule(callback, delayMs) {
    const timer = setTimeout(callback, delayMs);
    return { cancel: () => clearTimeout(timer) };
  },
};

function truncateToUtcMinute(date: Date): Date {
  const slot = new Date(date.getTime());
  slot.setUTCSeconds(0, 0);
  return slot;
}

function delayUntilNextMinute(date: Date): number {
  const remainder = date.getTime() % 60_000;
  return remainder === 0 ? 60_000 : 60_000 - remainder;
}

function jobEnabled(job: JobDefinition): boolean {
  for (const requirement of job.requires ?? []) {
    if (requirement === "multi" && getUptempoMode() !== "multi") return false;
    if (requirement === "sms" && resolveSmsProviderId(readProviderEnv()) === "none") {
      return false;
    }
    if (
      requirement === "push" &&
      (!process.env.APNS_KEY_ID || !process.env.APNS_TEAM_ID || !process.env.APNS_PRIVATE_KEY)
    ) {
      return false;
    }
  }
  return true;
}

export function runWorker(options: WorkerOptions): {
  done: Promise<void>;
  stop: () => Promise<void>;
} {
  const now = options.now ?? (() => new Date());
  const fetchImpl = options.fetchImpl ?? fetch;
  const sql = options.sql ?? (postgres(options.databaseUrl) as unknown as SqlClient);
  const scheduler = options.scheduler ?? nativeScheduler;
  const workerId = randomUUID();
  const targetUrl = options.targetUrl.replace(/\/+$/, "");
  const inflight = new Set<Promise<void>>();
  let stopped = false;
  let timer: { cancel(): void } | undefined;
  let lastPurgeDay = "";
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  console.log("[worker] started");

  async function runJob(job: JobDefinition, slot: Date): Promise<void> {
    const started = Date.now();
    const claimed = await sql`
      INSERT INTO job_runs (job_id, scheduled_for, worker_id)
      VALUES (${job.id}, ${slot}, ${workerId})
      ON CONFLICT DO NOTHING
      RETURNING job_id
    `;
    if (claimed.length === 0) return;

    const conn = await sql.reserve();
    let locked = false;
    let status = "error";
    let httpStatus: number | null = null;
    try {
      const lockRows = await conn`
        SELECT pg_try_advisory_lock(hashtextextended('uptempo:job:' || ${job.id}, 0)) AS locked
      `;
      locked = lockRows[0]?.locked === true;
      if (!locked) {
        status = "skipped_overlap";
      } else {
        try {
          const response = await fetchImpl(`${targetUrl}${job.path}`, {
            headers: { Authorization: `Bearer ${options.cronSecret}` },
            signal: AbortSignal.timeout(job.timeoutMs),
          });
          httpStatus = response.status;
          status = response.ok ? "ok" : `http_${response.status}`;
        } catch {
          status = "error";
          httpStatus = null;
        }
      }
      await sql`
        UPDATE job_runs
        SET status = ${status},
            http_status = ${httpStatus},
            finished_at = ${new Date()}
        WHERE job_id = ${job.id} AND scheduled_for = ${slot}
      `;
    } finally {
      if (locked) {
        await conn`
          SELECT pg_advisory_unlock(hashtextextended('uptempo:job:' || ${job.id}, 0))
        `;
      }
      conn.release();
    }
    console.log(`[worker] ran ${job.id} ${status} ${Date.now() - started}ms`);
  }

  function track(task: Promise<void>) {
    inflight.add(task);
    void task.finally(() => inflight.delete(task));
  }

  function tick(slot: Date) {
    for (const job of JOBS) {
      if (!matchesCron(job.schedule, slot) || !jobEnabled(job)) continue;
      track(runJob(job, slot));
    }
    if (slot.getUTCHours() === 3 && slot.getUTCMinutes() === 30) {
      const day = slot.toISOString().slice(0, 10);
      if (lastPurgeDay !== day) {
        lastPurgeDay = day;
        track(
          sql`DELETE FROM job_runs WHERE scheduled_for < now() - interval '30 days'`.then(
            () => undefined,
            (error: unknown) => {
              console.error("[worker] purge failed", error);
            },
          ),
        );
      }
    }
  }

  function arm(delay: number, armedAt: Date) {
    timer = scheduler.schedule(() => {
      if (stopped) return;
      const slot = truncateToUtcMinute(new Date(armedAt.getTime() + delay));
      tick(slot);
      arm(60_000, slot);
    }, delay);
  }

  async function stop() {
    if (stopped) return;
    stopped = true;
    timer?.cancel();
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
    await Promise.race([
      Promise.allSettled([...inflight]),
      new Promise((resolve) => setTimeout(resolve, 30_000)),
    ]);
    await sql.end({ timeout: 5 });
    resolveDone();
  }

  function onSignal() {
    void stop();
  }

  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  const startedAt = now();
  arm(delayUntilNextMinute(startedAt), startedAt);

  return { done, stop };
}
