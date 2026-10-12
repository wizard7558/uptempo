import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWorker } from "./worker";

const DATABASE_URL = process.env.DATABASE_URL;
const itDb = DATABASE_URL ? it : it.skip;

describe("job slot locking", () => {
  const slot = new Date("2030-01-06T12:07:00.000Z");
  let admin: ReturnType<typeof postgres> | undefined;

  beforeAll(async () => {
    if (!DATABASE_URL) return;
    admin = postgres(DATABASE_URL, { max: 1 });
    const migration = readFileSync(
      new URL("../../../drizzle/0031_job_runs.sql", import.meta.url),
      "utf8",
    );
    try {
      await admin.unsafe(migration);
    } catch (error) {
      if ((error as { code?: string }).code !== "42P07") throw error;
    }
    await admin`DELETE FROM job_runs WHERE scheduled_for = ${slot}`;
  });

  afterAll(async () => {
    if (!admin) return;
    await admin`DELETE FROM job_runs WHERE scheduled_for = ${slot}`;
    await admin.end();
  });

  itDb("lets two workers fetch a slot once", async () => {
    let fetches = 0;
    const fetchImpl: typeof fetch = async () => {
      fetches += 1;
      return new Response("ok", { status: 200 });
    };
    const now = () => new Date(slot.getTime() - 40);
    const first = runWorker({
      targetUrl: "http://web:3000",
      cronSecret: "secret",
      databaseUrl: DATABASE_URL!,
      fetchImpl,
      now,
    });
    const second = runWorker({
      targetUrl: "http://web:3000",
      cronSecret: "secret",
      databaseUrl: DATABASE_URL!,
      fetchImpl,
      now,
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    await Promise.all([first.stop(), second.stop()]);
    expect(fetches).toBe(1);
  });
});
