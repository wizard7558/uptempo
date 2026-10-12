/**
 * Applies the same migrations as `npm run migrate`, but against the **production**
 * database from Vercel env (DATABASE_URL). Requires: `vercel link`, `vercel login`,
 * and permission to pull production variables.
 *
 * Does not commit secrets: pulls to .env.production.local, reads DATABASE_URL,
 * deletes the file, then runs migrate with DATABASE_URL pinned for subprocesses.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, "..");
const envFile = path.join(projectDir, ".env.production.local");

function parseDatabaseUrlFromDotenv(content) {
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key !== "DATABASE_URL") continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    return val;
  }
  return null;
}

process.chdir(projectDir);

console.log("[migrate:production] Pulling Vercel production env…");
try {
  execSync("npx vercel env pull .env.production.local --environment=production --yes", {
    stdio: "inherit",
    env: process.env,
  });
} catch {
  console.error(
    "[migrate:production] vercel env pull failed. Is the project linked (`vercel link`) and are you logged in?",
  );
  process.exit(1);
}

if (!fs.existsSync(envFile)) {
  console.error("[migrate:production] Expected .env.production.local after pull.");
  process.exit(1);
}

const raw = fs.readFileSync(envFile, "utf8");
const databaseUrl = parseDatabaseUrlFromDotenv(raw);

try {
  fs.unlinkSync(envFile);
} catch {
  // ignore
}

if (!databaseUrl) {
  console.error(
    "[migrate:production] DATABASE_URL not found in pulled env. Add it in Vercel → Project → Settings → Environment Variables (Production).",
  );
  process.exit(1);
}

console.log(
  "[migrate:production] Running platform + tenant migrations against production DATABASE_URL…",
);

try {
  execSync("npm run migrate", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
} catch {
  process.exit(1);
}

console.log("[migrate:production] Done.");
