import { runWorker } from "../src/lib/jobs/worker";

async function main(): Promise<void> {
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

  await done;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
