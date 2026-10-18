import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";

import { buildBrandAssets, type BrandOutputRoots } from "./build-brand-assets";

const dirs: string[] = [];

async function run(): Promise<{ hashes: Map<string, string>; root: BrandOutputRoots; assets: Awaited<ReturnType<typeof buildBrandAssets>> }> {
  const base = await mkdtemp(path.join(tmpdir(), "brand-assets-"));
  dirs.push(base);
  const root = { web: path.join(base, "web"), native: path.join(base, "native") };
  const assets = await buildBrandAssets(root);
  const hashes = new Map<string, string>();
  for (const asset of assets) {
    const relative = path.relative(base, asset.file);
    hashes.set(relative, createHash("sha256").update(await readFile(asset.file)).digest("hex"));
  }
  return { hashes, root, assets };
}

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("build-brand-assets", () => {
  it("produces identical bytes on every run", async () => {
    const first = await run();
    const second = await run();
    expect(second.hashes).toEqual(first.hashes);
  }, 60_000);

  it("writes each PNG at its declared size, and opaque App Store icons", async () => {
    const { assets } = await run();
    const pngs = assets.filter((asset) => asset.file.endsWith(".png"));
    expect(pngs.map((asset) => path.basename(asset.file)).sort()).toEqual([
      "apple-icon-180.png",
      "apple-icon.png",
      "icon-192.png",
      "icon-512.png",
      "icon-maskable-512.png",
      "icon.png",
      "icon.png",
      "og-default.png",
    ]);
    for (const asset of pngs) {
      const meta = await sharp(asset.file).metadata();
      expect([meta.width, meta.height], asset.file).toEqual([asset.width, asset.height]);
      if (asset.file.includes(`${path.sep}native${path.sep}`)) {
        expect(meta.hasAlpha, asset.file).toBe(false);
      }
    }
  }, 60_000);
});
