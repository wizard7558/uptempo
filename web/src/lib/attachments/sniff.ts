export type AllowedMime =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/heic"
  | "image/heif"
  | "application/pdf";

export const MAX_UPLOAD_BYTES = 7 * 1024 * 1024;

const HEIC_BRANDS = new Set(["heic", "heix"]);
const HEIF_BRANDS = new Set(["mif1", "msf1", "heif"]);

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

/** Identify an upload from its leading bytes. Never trust the client's MIME type. */
export function sniffMime(buf: Buffer): AllowedMime | null {
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (startsWith(buf, [0x66, 0x74, 0x79, 0x70], 4) && buf.length >= 12) {
    const brand = buf.toString("ascii", 8, 12);
    if (HEIC_BRANDS.has(brand)) return "image/heic";
    if (HEIF_BRANDS.has(brand)) return "image/heif";
  }
  return null;
}
