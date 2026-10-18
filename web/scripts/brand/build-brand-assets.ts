/**
 * Renders every raster brand asset from the approved SVGs in public/brand.
 *
 *   npx tsx scripts/brand/build-brand-assets.ts
 *
 * Safe to run repeatedly: the same SVGs produce byte-identical PNGs.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE_DIR = path.join(WEB_ROOT, "public/brand");

const INK = "#0E0E0E";
const WHITE = "#FFFFFF";

export interface BrandOutputRoots {
  web: string;
  native: string;
}

export interface BrandAsset {
  file: string;
  width: number;
  height: number;
}

interface TileSpec {
  size: number;
  background: string;
  fill: string;
  /** Share of the tile the 400-unit mark box fills. */
  markScale: number;
}

function markPath(svg: string): string {
  const match = svg.match(/\sd="([^"]+)"/);
  if (!match) throw new Error("mark SVG has no path data");
  return match[1];
}

function tileSvg(d: string, { size, background, fill, markScale }: TileSpec): string {
  const box = size * markScale;
  const offset = (size - box) / 2;
  const scale = box / 400;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" fill="${background}"/>` +
    `<path transform="matrix(${scale} 0 0 ${scale} ${offset} ${offset})" fill="${fill}" d="${d}"/>` +
    `</svg>\n`
  );
}

async function png(svg: string | Buffer, opaque = false): Promise<Buffer> {
  let image = sharp(Buffer.from(svg), { density: 72 });
  if (opaque) image = image.flatten().removeAlpha();
  return image.png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer();
}

async function ogImage(lockup: string): Promise<Buffer> {
  const width = 1200;
  const height = 630;
  const logoWidth = 720;
  const logo = await sharp(Buffer.from(lockup), { density: 72 * 4 })
    .resize({ width: logoWidth })
    .png()
    .toBuffer();
  const { height: logoHeight = 0 } = await sharp(logo).metadata();
  return sharp({ create: { width, height, channels: 3, background: WHITE } })
    .composite([
      {
        input: logo,
        left: Math.round((width - logoWidth) / 2),
        top: Math.round((height - logoHeight) / 2),
      },
    ])
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
}

async function write(file: string, data: string | Buffer): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
}

export async function buildBrandAssets(out: BrandOutputRoots): Promise<BrandAsset[]> {
  const small = markPath(await readFile(path.join(SOURCE_DIR, "mark-small.svg"), "utf8"));
  const lockup = await readFile(path.join(SOURCE_DIR, "lockup.svg"), "utf8");

  const inkTile = (size: number, markScale = 0.7) =>
    tileSvg(small, { size, background: INK, fill: WHITE, markScale });

  const brand = (name: string) => path.join(out.web, "public/brand", name);
  const appleIcon = await png(inkTile(180), true);
  const ownerIcon = tileSvg(small, { size: 1024, background: WHITE, fill: INK, markScale: 0.62 });
  const clientIcon = tileSvg(small, { size: 1024, background: INK, fill: WHITE, markScale: 0.62 });

  const outputs: Array<[string, Buffer | string, number, number]> = [
    [brand("icon-192.png"), await png(inkTile(192)), 192, 192],
    [brand("icon-512.png"), await png(inkTile(512)), 512, 512],
    // Maskable icons keep the mark inside the central 80% safe zone.
    [brand("icon-maskable-512.png"), await png(inkTile(512, 0.56)), 512, 512],
    [brand("apple-icon-180.png"), appleIcon, 180, 180],
    [brand("og-default.png"), await ogImage(lockup), 1200, 630],
    [path.join(out.web, "src/app/apple-icon.png"), appleIcon, 180, 180],
    [path.join(out.native, "owner/assets/icon.svg"), ownerIcon, 1024, 1024],
    [path.join(out.native, "owner/assets/icon.png"), await png(ownerIcon, true), 1024, 1024],
    [path.join(out.native, "client/assets/icon.svg"), clientIcon, 1024, 1024],
    [path.join(out.native, "client/assets/icon.png"), await png(clientIcon, true), 1024, 1024],
  ];

  for (const [file, data] of outputs) await write(file, data);
  return outputs.map(([file, , width, height]) => ({ file, width, height }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildBrandAssets({ web: WEB_ROOT, native: path.resolve(WEB_ROOT, "../native") })
    .then((assets) => {
      for (const asset of assets) console.log(path.relative(process.cwd(), asset.file));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
