import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
const IGNORED = new Set(["NODE_ENV", "CI", "VITEST", "NEXT_RUNTIME"]);
const EXTRA_FILES = [
  "scripts/check-local-bootstrap.mjs",
  "scripts/migrate-platform.mjs",
  "scripts/migrate-tenants.ts",
  "scripts/worker.ts",
  "scripts/db-prepare.mjs",
  "drizzle.config.ts",
  "next.config.ts",
];

type Entry = { name: string; group: string; multi: string; single: string; description: string };
const registry: Entry[] = JSON.parse(
  fs.readFileSync(path.join(root, "env.registry.json"), "utf8"),
);
const names = new Set(registry.map((e) => e.name));

function walk(dir: string, out: string[]) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(ent.name) && !/\.test\./.test(ent.name)) out.push(p);
  }
}

function scan(): Map<string, string[]> {
  const files: string[] = [];
  walk(path.join(root, "src"), files);
  for (const f of EXTRA_FILES) {
    const p = path.join(root, f);
    if (fs.existsSync(p)) files.push(p);
  }
  const found = new Map<string, string[]>();
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      const list = found.get(m[1]) ?? [];
      list.push(path.relative(root, f));
      found.set(m[1], list);
    }
  }
  return found;
}

describe("env registry", () => {
  it("has unique, well-formed entries", () => {
    expect(names.size).toBe(registry.length);
    for (const e of registry) {
      expect(e.name).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(e.group).toBeTruthy();
      expect(e.description).toBeTruthy();
      expect(["R", "O", "-"]).toContain(e.multi);
      expect(["R", "O", "-"]).toContain(e.single);
    }
  });

  it("lists every env var the code reads", () => {
    const missing = [...scan()]
      .filter(([n]) => !IGNORED.has(n) && !names.has(n))
      .map(([n, files]) => `${n} (${[...new Set(files)].join(", ")})`);
    expect(missing, `Add to env.registry.json: ${missing.join("; ")}`).toEqual([]);
  });

  it("lists every registry name in .env.example", () => {
    const example = fs.readFileSync(path.join(root, ".env.example"), "utf8");
    const missing = registry
      .map((e) => e.name)
      .filter((n) => !new RegExp(`^#?\\s*${n}=`, "m").test(example));
    expect(missing, `Add to .env.example: ${missing.join(", ")}`).toEqual([]);
  });
});
