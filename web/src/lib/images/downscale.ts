/**
 * Client-side image downscaling (browser only). Phone photos are 3–8MB; the
 * storefront renders them at card size, so we resize to ≤1600px JPEG before
 * uploading — faster uploads and a faster store for clients on phones.
 *
 * Returns null when the browser can't decode the file (e.g. HEIC outside
 * Safari) — callers should fall back to uploading the original.
 */

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.85;

export async function downscaleImageFile(file: File): Promise<File | null> {
  // SVGs are already tiny and scale losslessly — never rasterize them.
  if (file.type === "image/svg+xml") return null;

  try {
    const bitmap = await createImageBitmap(file);
    try {
      const { width, height } = bitmap;
      const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));

      // Already small and web-friendly → keep the original bytes.
      if (scale === 1 && (file.type === "image/jpeg" || file.type === "image/webp")) {
        return null;
      }

      const targetW = Math.max(1, Math.round(width * scale));
      const targetH = Math.max(1, Math.round(height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      // White backdrop so transparent PNGs don't turn black as JPEG.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, targetW, targetH);
      ctx.drawImage(bitmap, 0, 0, targetW, targetH);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
      );
      if (!blob) return null;

      const base = file.name.replace(/\.[^.]+$/, "") || "photo";
      return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
    } finally {
      bitmap.close();
    }
  } catch {
    // Browser couldn't decode (HEIC on Chrome, corrupt file, …).
    return null;
  }
}
