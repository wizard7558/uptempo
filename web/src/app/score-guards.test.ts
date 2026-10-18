import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PATTERNS = [
  "text-[9px]",
  "text-[10px]",
  "text-[11px]",
  "text-[12px]",
  "font-serif",
  "font-playfair",
  "font-geist-sans",
  'variant="editorial',
  'size="xs"',
  'size="sm"',
  'size="icon-sm"',
  'size="icon-xs"',
];

const SKIP_DIRS = new Set(["node_modules", ".next"]);

function files(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      files(full, out);
    } else if (!entry.includes(".test.") && !entry.includes(".spec.")) {
      out.push(full);
    }
  }
  return out;
}

describe("score guards", () => {
  it("rejects small type, old fonts, and undersized control props", () => {
    const hits: string[] = [];
    for (const file of files(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const pattern of PATTERNS) {
        if (text.includes(pattern)) {
          hits.push(`${path.relative(SRC, file)}: ${pattern}`);
        }
      }
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });

  // `--accent` is crimson (or the business color on booking pages) and is
  // reserved for "now", the selected item, and links. Hover, focus, open,
  // and loading surfaces use `muted`.
  it("keeps the accent off hover, focus, and loading surfaces", () => {
    const NEUTRAL_ACCENT = [
      /(?:hover|focus|data-\[[^\]]+\]):bg-accent\b/,
      /\bbg-accent\b[^"]*\banimate-pulse\b|\banimate-pulse\b[^"]*\bbg-accent\b/,
    ];
    const hits: string[] = [];
    for (const file of files(SRC)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (NEUTRAL_ACCENT.some((re) => re.test(line))) {
          hits.push(`${path.relative(SRC, file)}:${i + 1}`);
        }
      });
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });
});
