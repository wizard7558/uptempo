/**
 * Generates printable QR codes for the public `/quiz` and `/waitlist` pages.
 *
 * Every code encodes a `?src=<label>` attribution param, so a scan from the
 * salon-chair card and a scan from an expo flyer land in different rows of
 * `quiz_responses.source` / `waitlist_signups.source`. Labels are validated
 * against `cleanSource` — the same normalizer the server actions apply — so the
 * printed code can never encode a label that gets rewritten on the way in.
 *
 * Writes an SVG (vector, for print) and a 2048px PNG (for slides, stories, and
 * anything that won't take an SVG) per code into `public/qr/`. Files there are
 * served publicly, so a printer can also just fetch
 * `https://<host>/qr/quiz-flyer.svg`.
 *
 * Usage (from `web/`):
 *
 *   npx tsx scripts/generate-qr-codes.ts
 *       Regenerate the default set below, using NEXT_PUBLIC_APP_URL as the base.
 *
 *   npx tsx scripts/generate-qr-codes.ts --base https://bookuptempo.com
 *       Pin the base URL explicitly (do this when generating for print — the
 *       env fallback is localhost).
 *
 *   npx tsx scripts/generate-qr-codes.ts --path /quiz --src expo-2026
 *       Generate one extra code instead of the default set. Repeat --src to
 *       make several for the same page.
 *
 *   npx tsx scripts/generate-qr-codes.ts --out public/qr --dry-run
 *       Change the output directory / print what would be written.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import QRCode from "qrcode";
import { cleanSource } from "../src/lib/attribution";

/**
 * Pages we generate codes for by default, and the placements each one covers.
 *
 * Flyers only, because that's where Emma is starting — keeping the committed
 * set to exactly what's in use means there's no chance of sending the wrong
 * file to a printer. New placements are a one-liner:
 *
 *   npm run qr:generate -- --base https://bookuptempo.com --path /quiz --src chair
 */
const DEFAULT_TARGETS: Array<{ path: string; sources: string[] }> = [
  // The prospect feedback survey — the main thing going on printed material.
  { path: "/quiz", sources: ["flyer"] },
  // Pre-launch waitlist, for anything with a longer shelf life.
  { path: "/waitlist", sources: ["flyer"] },
];

const DEFAULT_OUT_DIR = "public/qr";

/** High error correction so a scuffed or partly-covered print still scans. */
const QR_OPTIONS = { errorCorrectionLevel: "H" as const, margin: 2 };

/** Print resolution for the PNG — large enough for a full-page flyer. */
const PNG_WIDTH = 2048;

type Args = {
  base?: string;
  out: string;
  path?: string;
  sources: string[];
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { out: DEFAULT_OUT_DIR, sources: [], dryRun: false };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case "--base":
        args.base = requireValue(flag, value);
        i++;
        break;
      case "--out":
        args.out = requireValue(flag, value);
        i++;
        break;
      case "--path":
        args.path = requireValue(flag, value);
        i++;
        break;
      case "--src":
        args.sources.push(requireValue(flag, value));
        i++;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      default:
        fail(`Unknown argument: ${flag}`);
    }
  }

  if (args.sources.length > 0 && !args.path) {
    fail("--src requires --path (which page the code should point at).");
  }

  return args;
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) fail(`${flag} needs a value.`);
  return value;
}

function fail(message: string): never {
  console.error(`[qr] ${message}`);
  process.exit(1);
}

/**
 * Resolve the base URL for the encoded links. Deliberately does NOT fall back
 * to localhost: a QR code pointing at localhost is worthless and the mistake
 * only surfaces after something is printed.
 */
function resolveBase(explicit: string | undefined): string {
  const base =
    explicit ??
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined);

  if (!base) {
    fail(
      "No base URL. Pass --base https://bookuptempo.com or set NEXT_PUBLIC_APP_URL.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    fail(`--base is not a valid URL: ${base}`);
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    fail(`--base must be https (got ${parsed.protocol}//${parsed.hostname}).`);
  }
  return base.replace(/\/$/, "");
}

/**
 * Reject any label that `cleanSource` would rewrite. The printed code is
 * permanent — if "Expo 2026" silently became "expo-2026" on the server, the
 * label on the design file and the label in the database would disagree.
 */
function assertStableSource(source: string, path: string): string {
  const cleaned = cleanSource(source);
  if (cleaned !== source) {
    fail(
      `Source "${source}" (for ${path}) is not a stable label. ` +
        `Use "${cleaned ?? "<empty>"}" instead — lowercase letters, digits and hyphens only.`,
    );
  }
  return source;
}

/** `/quiz` + `card` → `quiz-card`. Used for both the SVG and PNG filenames. */
function fileStem(path: string, source: string): string {
  const page = path.replace(/^\/+|\/+$/g, "").replace(/\//g, "-") || "home";
  return `${page}-${source}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = resolveBase(args.base);

  const targets =
    args.path && args.sources.length > 0
      ? [{ path: args.path, sources: args.sources }]
      : DEFAULT_TARGETS;

  const codes = targets.flatMap((target) => {
    const path = target.path.startsWith("/") ? target.path : `/${target.path}`;
    return target.sources.map((source) => {
      assertStableSource(source, path);
      return {
        stem: fileStem(path, source),
        url: `${base}${path}?src=${source}`,
      };
    });
  });

  const outDir = resolve(process.cwd(), args.out);

  if (args.dryRun) {
    console.log(`[qr] Dry run — would write ${codes.length * 2} files to ${outDir}:`);
  } else {
    await mkdir(outDir, { recursive: true });
  }

  for (const code of codes) {
    if (!args.dryRun) {
      const svg = await QRCode.toString(code.url, {
        ...QR_OPTIONS,
        type: "svg",
      });
      const png = await QRCode.toBuffer(code.url, {
        ...QR_OPTIONS,
        type: "png",
        width: PNG_WIDTH,
      });
      await writeFile(resolve(outDir, `${code.stem}.svg`), svg, "utf8");
      await writeFile(resolve(outDir, `${code.stem}.png`), png);
    }
    console.log(`  ${code.stem}.{svg,png}  →  ${code.url}`);
  }

  if (!args.dryRun) {
    console.log(`\n[qr] Wrote ${codes.length * 2} files to ${outDir}.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
