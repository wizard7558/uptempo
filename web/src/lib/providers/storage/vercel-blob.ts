import { del, put } from "@vercel/blob";
import {
  PRIVATE_UNSUPPORTED_ERROR,
  type StorageProvider,
  resolveStoredKey,
} from "./types";

/** Vercel / .env sometimes stores values with wrapping quotes or trailing newlines. */
export function normalizeEnvToken(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let t = raw.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    t = t.slice(1, -1).trim();
  }
  return t || undefined;
}

/** True when the URL points into our Vercel Blob store (safe to delete). */
export function isVercelBlobUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === "vercel-storage.com" || host.endsWith(".vercel-storage.com");
  } catch {
    return false;
  }
}

/**
 * Vercel Blob provider (public only). The app's store must be public so
 * unauthenticated pages can render images. @vercel/blob 2.x supports
 * `access: "private"` stores, but a store is either public or private and has
 * no signed-read URLs, so private objects are not supported here: use
 * STORAGE_PROVIDER=s3 or local.
 */
export function createVercelBlobProvider(): StorageProvider {
  const token = () => normalizeEnvToken(process.env.BLOB_READ_WRITE_TOKEN);
  return {
    id: "vercel-blob",
    configError: () =>
      token()
        ? null
        : "Image upload is not configured (missing BLOB_READ_WRITE_TOKEN). In Vercel: Project → Settings → Environment Variables → add BLOB_READ_WRITE_TOKEN (Storage → Blob).",
    async put({ key, body, contentType, visibility }) {
      if (visibility === "private") throw new Error(PRIVATE_UNSUPPORTED_ERROR);
      const t = token();
      if (!t) throw new Error("missing BLOB_READ_WRITE_TOKEN");
      const stored = resolveStoredKey({ key });
      const blob = await put(stored, body, {
        access: "public",
        addRandomSuffix: true,
        contentType,
        token: t,
      });
      return { url: blob.url, key: stored };
    },
    async delete(url) {
      if (!isVercelBlobUrl(url)) return;
      const t = token();
      if (!t) return;
      await del(url, { token: t });
    },
    async deleteByKey() {
      throw new Error(PRIVATE_UNSUPPORTED_ERROR);
    },
    owns: isVercelBlobUrl,
    async getSignedReadUrl() {
      throw new Error(PRIVATE_UNSUPPORTED_ERROR);
    },
  };
}
