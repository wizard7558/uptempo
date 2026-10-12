import fs from "node:fs/promises";
import path from "node:path";
import { getBaseUrl } from "@/lib/utils";
import { signPrivateKey } from "./signing";
import {
  type StorageProvider,
  assertSafeKey,
  resolveStoredKey,
} from "./types";

export const FILES_ROUTE_PREFIX = "/api/files/";

/** Root directory for local storage. */
export function getLocalStorageDir(): string {
  const configured = process.env.STORAGE_LOCAL_DIR?.trim();
  if (configured) return path.resolve(configured);
  return process.env.NODE_ENV === "production"
    ? "/data/uploads"
    : path.join(process.cwd(), ".uploads");
}

/**
 * Resolve URL path segments to an absolute file path inside `root`, or null if
 * any segment is empty, `..`, `.`, contains a backslash/NUL, or the result
 * escapes the root.
 */
export function resolveLocalPath(root: string, segments: string[]): string | null {
  if (segments.length === 0) return null;
  for (const s of segments) {
    if (!s || s === "." || s === ".." || s.includes("\\") || s.includes("\0") || s.includes("/")) {
      return null;
    }
  }
  const resolvedRoot = path.resolve(root);
  const full = path.resolve(resolvedRoot, ...segments);
  return full.startsWith(resolvedRoot + path.sep) ? full : null;
}

export function createLocalProvider(
  opts: { dir?: string; baseUrl?: () => string } = {},
): StorageProvider {
  const dir = () => opts.dir ?? getLocalStorageDir();
  const base = () => (opts.baseUrl ?? getBaseUrl)().replace(/\/+$/, "");

  function keyFromUrl(url: string | null | undefined): string | null {
    if (!url) return null;
    try {
      const u = new URL(url);
      if (u.host !== new URL(base()).host) return null;
      if (!u.pathname.startsWith(FILES_ROUTE_PREFIX)) return null;
      const key = decodeURIComponent(u.pathname.slice(FILES_ROUTE_PREFIX.length));
      return key || null;
    } catch {
      return null;
    }
  }

  async function removeKey(key: string): Promise<void> {
    const target = resolveLocalPath(dir(), key.split("/"));
    if (!target) return;
    await fs.rm(target, { force: true });
  }

  return {
    id: "local",
    configError: () => null,
    async put({ key, body, visibility }) {
      const stored = resolveStoredKey({ key, visibility });
      const target = resolveLocalPath(dir(), stored.split("/"));
      if (!target) throw new Error(`Invalid storage key: ${JSON.stringify(key)}`);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, Buffer.from(await body.arrayBuffer()));
      return { url: `${base()}${FILES_ROUTE_PREFIX}${stored}`, key: stored };
    },
    async delete(url) {
      const key = keyFromUrl(url);
      if (key) await removeKey(key);
    },
    async deleteByKey(key) {
      assertSafeKey(key);
      await removeKey(key);
    },
    owns: (url) => keyFromUrl(url) !== null,
    async getSignedReadUrl(key, ttlSeconds) {
      assertSafeKey(key);
      const { exp, sig } = signPrivateKey(key, ttlSeconds);
      return `${base()}${FILES_ROUTE_PREFIX}${key}?exp=${exp}&sig=${sig}`;
    },
  };
}
