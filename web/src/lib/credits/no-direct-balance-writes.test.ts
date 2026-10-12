// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

/**
 * `client_packages.credits_remaining` is a cache owned by the credit_ledger insert
 * trigger. This test fails if any TypeScript or SQL string under src/ (apart from
 * the tenant migrations that define the trigger) writes it directly.
 */

const SRC = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(SRC, "lib", "tenant", "migrations") + path.sep;
const SELF = __filename;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|sql)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Text inside each `.set( ... )` call, found by matching parentheses. */
export function setCallBodies(source: string): string[] {
  const bodies: string[] = [];
  const re = /\.set\(/g;
  while (re.exec(source)) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < source.length && depth > 0) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")") depth--;
      i++;
    }
    bodies.push(source.slice(re.lastIndex, i - 1));
  }
  return bodies;
}

export function findViolations(source: string): string[] {
  const found: string[] = [];
  if (setCallBodies(source).some((b) => /\bcreditsRemaining\s*:/.test(b))) {
    found.push("creditsRemaining: inside .set(");
  }
  if (/credits_remaining\s*=(?!=)/.test(source)) found.push("credits_remaining =");
  return found;
}

describe("credits_remaining is only written by the ledger trigger", () => {
  it("no file under src/ outside the tenant migrations writes it", () => {
    const offenders = walk(SRC)
      .filter((f) => f !== SELF && !f.startsWith(MIGRATIONS))
      .map((f) => ({ f, v: findViolations(fs.readFileSync(f, "utf8")) }))
      .filter((x) => x.v.length > 0)
      .map((x) => `${path.relative(SRC, x.f)}: ${x.v.join(", ")}`);
    expect(offenders).toEqual([]);
  });

  it("catches the patterns it is meant to forbid", () => {
    expect(
      findViolations("await db.update(clientPackages).set({ creditsRemaining: 5, updatedAt: new Date() })"),
    ).toHaveLength(1);
    expect(findViolations("UPDATE client_packages SET credits_remaining = 3")).toHaveLength(1);
    expect(findViolations("db.update(x).set({ name: 'a' }); const creditsRemaining: number = 1;")).toEqual([]);
    expect(findViolations("SELECT credits_remaining FROM client_packages WHERE credits_remaining > 0")).toEqual([]);
  });
});
