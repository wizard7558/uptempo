import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../..", import.meta.url));
const SCHEMA_FILE = join(SRC, "lib/db/schema/tenants.ts");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx|mjs|js)$/.test(name) && !/\.test\./.test(name)
      ? [full]
      : [];
  });
}

const files = walk(SRC);
// Built from parts so this guard does not match its own search strings.
const GATE_MODULE = ["feature", "gate"].join("-");
const GATE_CALL = ["has", "Feature("].join("");

describe("plan gates stay removed (Phase 1.7)", () => {
  it("scans source files", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("the plan-gate module no longer exists", () => {
    expect(existsSync(join(SRC, `lib/tenant/${GATE_MODULE}.ts`))).toBe(false);
  });

  it("nothing imports the plan-gate module or calls its check", () => {
    const offenders = files.filter((f) => {
      const text = readFileSync(f, "utf8");
      return (
        text.includes(`lib/tenant/${GATE_MODULE}`) || text.includes(GATE_CALL)
      );
    });
    expect(offenders).toEqual([]);
  });

  it("assistant seats are only referenced by the frozen schema column", () => {
    const offenders = files.filter(
      (f) =>
        f !== SCHEMA_FILE &&
        /assistantSeats|assistant_seats/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
