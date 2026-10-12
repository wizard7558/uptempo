/**
 * Vercel ignored-build command.
 * Exit 0 skips the deployment. Exit 1 lets the build continue.
 *
 * A production commit that changes the database migration inputs is skipped.
 * GitHub Actions applies those migrations on push to main. Promote that commit
 * to production only after the migrate job is green. Preview builds are unchanged.
 */
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const MIGRATION_PATH =
  /(?:^|\/)drizzle\/|src\/lib\/tenant\/migrations\/|scripts\/migrate-platform\.mjs$|scripts\/migrate-production\.mjs$|scripts\/migrate-tenants\.ts$|scripts\/archive-legacy-public\.mjs$|\.github\/workflows\/migrate-production\.yml$/;

/**
 * @param {string[]} files
 * @param {string | undefined} vercelEnv
 * @returns {boolean} true when this production deployment must wait
 */
export function productionBuildShouldWait(files, vercelEnv) {
  if (vercelEnv && vercelEnv !== "production") return false;
  return files.some((file) => MIGRATION_PATH.test(file));
}

function changedFiles() {
  const output = execSync("git show --name-only --pretty=format: --first-parent HEAD", {
    encoding: "utf8",
  });
  return output.split("\n").map((line) => line.trim()).filter(Boolean);
}

function main() {
  const vercelEnv = process.env.VERCEL_ENV;
  let files;
  try {
    files = changedFiles();
  } catch (error) {
    if (!vercelEnv || vercelEnv === "production") {
      console.log(
        "Skipping production build: could not list files in HEAD, so a migration may be included.",
      );
      console.error(error instanceof Error ? error.message : error);
      process.exit(0);
    }
    process.exit(1);
  }
  if (productionBuildShouldWait(files, vercelEnv)) {
    console.log(
      "Skipping production build until the database migration succeeds. Promote this commit only after the migrate job is green.",
    );
    process.exit(0);
  }
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
