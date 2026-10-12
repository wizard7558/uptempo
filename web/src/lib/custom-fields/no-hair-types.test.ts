import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../..");
const FIELD_KEY = /key:\s*["']hair_types["']/g;
const FORBIDDEN = /hairTypes|PRODUCT_HAIR_TYPES|hair_types/;

function filesUnder(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      filesUnder(path, out);
      continue;
    }
    const rel = relative(SRC, path).split("\\").join("/");
    if (rel.startsWith("lib/tenant/migrations/") || rel.includes(".test.")) continue;
    out.push(path);
  }
  return out;
}

describe("dropped hair_types columns", () => {
  it("src no longer reads hair_types except the client field key", () => {
    const hits: string[] = [];
    for (const path of filesUnder(SRC)) {
      const text = readFileSync(path, "utf8").replace(FIELD_KEY, "");
      if (FORBIDDEN.test(text)) hits.push(relative(SRC, path));
    }
    expect(hits).toEqual([]);
  });
});
