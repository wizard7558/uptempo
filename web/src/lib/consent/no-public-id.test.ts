// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * ID photos must never get a public URL. This walks `src/` and fails when
 * a file asks for public storage next to the `id_document` kind, or when any
 * file other than the storage provider calls Vercel Blob's `put` directly
 * (which would bypass the private-by-default storage interface).
 */
const SRC = path.resolve(__dirname, "../..");
const SELF = path.resolve(__dirname, "no-public-id.test.ts");
/** The only module allowed to import `put` from `@vercel/blob`. */
const BLOB_PROVIDER = path.join(SRC, "lib/providers/storage/vercel-blob.ts");
/** Its own unit test imports `put` to assert against the mocked SDK. */
const BLOB_PROVIDER_TEST = path.join(SRC, "lib/providers/storage/vercel-blob.test.ts");

const PUBLIC_OPTION = /\b(?:visibility|access)\s*:\s*["'`]public["'`]/;
const BLOB_PUT_IMPORT = /import\s*(?:type\s*)?\{[^}]*\bput\b[^}]*\}\s*from\s*["']@vercel\/blob["']/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function findPublicIdUses(files: Array<{ file: string; text: string }>): string[] {
  return files
    .filter(({ file, text }) => file !== SELF && text.includes("id_document") && PUBLIC_OPTION.test(text))
    .map(({ file }) => path.relative(SRC, file));
}

function findBlobPutImports(files: Array<{ file: string; text: string }>): string[] {
  return files
    .filter(({ file, text }) => file !== BLOB_PROVIDER && file !== BLOB_PROVIDER_TEST && file !== SELF && BLOB_PUT_IMPORT.test(text))
    .map(({ file }) => path.relative(SRC, file));
}

const files = walk(SRC).map((file) => ({ file, text: fs.readFileSync(file, "utf8") }));

describe("ID documents are never public", () => {
  it("scans real source files", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.file === BLOB_PROVIDER)).toBe(true);
  });

  it("no file combines id_document with a public visibility or access option", () => {
    expect(findPublicIdUses(files)).toEqual([]);
  });

  it("only the Vercel Blob provider (and its test) imports put from @vercel/blob", () => {
    expect(findBlobPutImports(files)).toEqual([]);
  });

  it("the checks catch a violation", () => {
    const bad = [
      { file: path.join(SRC, "x/a.ts"), text: `kind: "id_document"; put({ visibility: "public" })` },
      { file: path.join(SRC, "x/b.ts"), text: `const kind = "id_document"; const o = { access: 'public' };` },
      { file: path.join(SRC, "x/c.ts"), text: `import { del, put } from "@vercel/blob";` },
    ];
    expect(findPublicIdUses(bad)).toEqual([path.join("x", "a.ts"), path.join("x", "b.ts")]);
    expect(findBlobPutImports(bad)).toEqual([path.join("x", "c.ts")]);
    expect(findBlobPutImports([{ file: BLOB_PROVIDER, text: bad[2].text }])).toEqual([]);
  });
});
