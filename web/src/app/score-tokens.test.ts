import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { contrastRatio } from "@/lib/utils/contrast";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "globals.css"),
  "utf8",
);

const PAIRS = [
  ["foreground", "background", 4.5],
  ["muted-foreground", "background", 4.5],
  ["input", "background", 3],
  ["primary-foreground", "primary", 4.5],
  ["accent", "background", 4.5],
  ["accent-foreground", "accent", 4.5],
] as const;

function block(source: string, header: RegExp): string {
  const match = header.exec(source);
  if (!match || match.index === undefined) {
    throw new Error(`Missing CSS block ${header}`);
  }
  const open = source.indexOf("{", match.index);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`Unclosed CSS block ${header}`);
}

function tokens(source: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of source.matchAll(/--([\w-]+)\s*:\s*(#[0-9A-Fa-f]{6})\s*;/g)) {
    found.set(match[1], match[2].toUpperCase());
  }
  return found;
}

describe("Score tokens", () => {
  const scopes = {
    light: tokens(block(css, /:root\s*,\s*\.light\s*\{/)),
    dark: tokens(block(css, /\.dark\s*\{/)),
  };

  for (const [scope, values] of Object.entries(scopes)) {
    for (const [foreground, background, min] of PAIRS) {
      it(`${scope} ${foreground} on ${background} is at least ${min}:1`, () => {
        const fg = values.get(foreground);
        const bg = values.get(background);
        expect(fg, `${scope} --${foreground}`).toMatch(/^#[0-9A-F]{6}$/);
        expect(bg, `${scope} --${background}`).toMatch(/^#[0-9A-F]{6}$/);
        expect(contrastRatio(fg!, bg!)).toBeGreaterThanOrEqual(min);
      });
    }
  }
});
