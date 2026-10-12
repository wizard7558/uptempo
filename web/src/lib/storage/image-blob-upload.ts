import { getStorageProvider } from "@/lib/providers/storage";

export { isVercelBlobUrl, normalizeEnvToken } from "@/lib/providers/storage/vercel-blob";

/**
 * Shared image upload (server-only). One implementation behind the salon-logo
 * and product-photo uploads: type allow-list, size cap, old-file cleanup on
 * replace, and public storage so unauthenticated pages can render the images.
 * Storage is delegated to the configured StorageProvider (vercel-blob, local
 * or s3); the exported names are kept for existing callers.
 */

export const ALLOWED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/svg+xml",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
] as const;

export function inferMimeFromName(fileName: string): string {
  const n = fileName.toLowerCase();
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".svg")) return "image/svg+xml";
  if (n.endsWith(".gif")) return "image/gif";
  if (n.endsWith(".heic")) return "image/heic";
  if (n.endsWith(".heif")) return "image/heif";
  return "";
}

export function effectiveMimeType(file: File): string {
  if (file.type && file.type !== "application/octet-stream") {
    return file.type;
  }
  return inferMimeFromName(file.name);
}

export function safeImageExtension(fileName: string, mime: string): string {
  const fromName = fileName.split(".").pop()?.toLowerCase();
  if (
    fromName &&
    ["png", "jpg", "jpeg", "webp", "svg", "gif", "heic", "heif"].includes(fromName)
  ) {
    return fromName === "jpg" ? "jpeg" : fromName;
  }
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  if (mime === "image/svg+xml") return "svg";
  if (mime === "image/gif") return "gif";
  if (mime === "image/heic") return "heic";
  if (mime === "image/heif") return "heif";
  return "png";
}

export type UploadImageToBlobResult =
  | { ok: true; url: string }
  | { ok: false; error: string; detail?: string };

/**
 * Validate and store an image under `pathPrefix/` via the storage provider,
 * deleting the replaced file (if any) best-effort.
 */
export async function uploadImageToBlobStorage(input: {
  pathPrefix: string;
  key: string;
  file: File;
  oldUrl: string | null;
  maxBytes: number;
}): Promise<UploadImageToBlobResult> {
  const provider = getStorageProvider();
  const configError = provider.configError();
  if (configError) return { ok: false, error: configError };

  const { pathPrefix, key, file, oldUrl, maxBytes } = input;

  const mime = effectiveMimeType(file);
  if (
    !mime ||
    !ALLOWED_IMAGE_TYPES.includes(mime as (typeof ALLOWED_IMAGE_TYPES)[number])
  ) {
    return {
      ok: false,
      error:
        "Invalid file type. Use PNG, JPG, SVG, WebP, GIF, or HEIC. If you dragged a file in, try picking it with the file chooser instead.",
    };
  }

  if (file.size > maxBytes) {
    return {
      ok: false,
      error: `File too large. Maximum ${Math.round(maxBytes / (1024 * 1024))}MB.`,
    };
  }

  if (provider.owns(oldUrl)) {
    try {
      await provider.delete(oldUrl as string);
    } catch {
      // Old file may already be deleted — ignore
    }
  }

  const ext = safeImageExtension(file.name, mime);
  const pathname = `${pathPrefix}/${key}.${ext}`;

  const body: Blob =
    file.type && file.type !== "application/octet-stream"
      ? file
      : new Blob([await file.arrayBuffer()], { type: mime });

  try {
    const stored = await provider.put({
      key: pathname,
      body,
      contentType: mime,
    });
    return { ok: true, url: stored.url };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[image-blob-upload] put failed (${pathPrefix}):`, message);
    const line = message.split("\n")[0].trim();

    if (provider.id === "vercel-blob") {
      if (
        line.includes("private store") ||
        line.includes("private access") ||
        line.includes("public access")
      ) {
        return {
          ok: false,
          error:
            "This Vercel Blob store is set to private access, but these images must be public so client-facing pages can show them without a login.",
          detail:
            "In Vercel → Storage → open your Blob store → set access to Public (or create a new public Blob store), then create a new read-write token and set BLOB_READ_WRITE_TOKEN on Production.",
        };
      }
      return {
        ok: false,
        error:
          "Could not store the image in Blob storage. Re-copy BLOB_READ_WRITE_TOKEN from Vercel → Storage → Blob and ensure Production has the variable, then redeploy.",
        detail: line.slice(0, 280) || undefined,
      };
    }

    return {
      ok: false,
      error: `Could not store the image (${provider.id} storage). Check the storage settings and try again.`,
      detail: line.slice(0, 280) || undefined,
    };
  }
}

/** Best-effort delete of an image we previously stored. */
export async function deleteBlobImageIfOurs(
  url: string | null | undefined,
): Promise<void> {
  const provider = getStorageProvider();
  if (!provider.owns(url)) return;
  if (provider.configError()) return;
  try {
    await provider.delete(url as string);
  } catch {
    // already gone — ignore
  }
}
