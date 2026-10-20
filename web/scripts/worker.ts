import { runWorker } from "../src/lib/jobs/worker";

const cronSecret = process.env.CRON_SECRET;
const databaseUrl = process.env.DATABASE_URL;

if (!cronSecret) {
  console.error("CRON_SECRET is required");
  process.exit(1);
}
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const { done } = runWorker({
  targetUrl: process.env.UPTEMPO_WORKER_TARGET_URL ?? "http://web:3000",
  cronSecret,
  databaseUrl,
});

// tsx runs this file as CJS, so no top-level await. The pending `done` promise
// and the worker's timers keep the process alive; a rejection exits non-zero.
done.then(
  () => process.exit(0),
  (error: unknown) => {
    console.error("[worker] stopped with an error", error);
    process.exit(1);
  },
);
