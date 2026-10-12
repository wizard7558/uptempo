export type StorageProviderId = "vercel-blob" | "local" | "s3";
export type StorageVisibility = "public" | "private";

/** Keys under this prefix are private and are never served without a signature. */
export const PRIVATE_KEY_PREFIX = "private/";

export interface StoragePutInput {
  /**
   * Desired object key including extension, e.g. `logos/user-1.png`. The provider
   * inserts a uniqueness suffix before the extension. Public keys must not start
   * with `private/`; private puts get the `private/` prefix added.
   */
  key: string;
  body: Blob;
  contentType: string;
  /** Defaults to "public". */
  visibility?: StorageVisibility;
}

export interface StoragePutResult {
  /** Public: the URL to store and render. Private: a reference URL that is NOT readable without a signature. */
  url: string;
  /** The stored object key. Pass it to `getSignedReadUrl` for private objects. */
  key: string;
}

export interface StorageProvider {
  readonly id: StorageProviderId;
  /** null when ready; otherwise a user-facing reason (e.g. missing token). */
  configError(): string | null;
  put(input: StoragePutInput): Promise<StoragePutResult>;
  /** Accepts a URL previously returned by `put`. */
  delete(url: string): Promise<void>;
  /** Deletes by the key returned by `put` (private files store only the key, never a URL). Missing objects are not an error. */
  deleteByKey(key: string): Promise<void>;
  /** True when `url` was produced by this provider (safe to delete). */
  owns(url: string | null | undefined): boolean;
  /** Time-limited read URL for a private object (the key returned by `put`). */
  getSignedReadUrl(key: string, ttlSeconds: number): Promise<string>;
}

export const PRIVATE_UNSUPPORTED_ERROR =
  "Private files require STORAGE_PROVIDER=s3 or local";

/** Reject keys that are empty, absolute, or contain traversal segments. */
export function assertSafeKey(key: string): void {
  const segments = key.split("/");
  if (
    !key ||
    key.includes("\\") ||
    key.includes("\0") ||
    segments.some((s) => s === "" || s === "." || s === "..")
  ) {
    throw new Error(`Invalid storage key: ${JSON.stringify(key)}`);
  }
}

/** Insert `-<timestamp>-<random>` before the extension. */
export function uniqueKey(key: string): string {
  const slash = key.lastIndexOf("/");
  const dot = key.lastIndexOf(".");
  const suffix = `-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  if (dot > slash + 1) return `${key.slice(0, dot)}${suffix}${key.slice(dot)}`;
  return `${key}${suffix}`;
}

/** Validate visibility vs. prefix and return the key to store. */
export function resolveStoredKey(input: Pick<StoragePutInput, "key" | "visibility">): string {
  assertSafeKey(input.key);
  const isPrivateKey = input.key.startsWith(PRIVATE_KEY_PREFIX);
  if (input.visibility === "private") {
    return uniqueKey(isPrivateKey ? input.key : `${PRIVATE_KEY_PREFIX}${input.key}`);
  }
  if (isPrivateKey) {
    throw new Error(`Public storage keys must not start with "${PRIVATE_KEY_PREFIX}"`);
  }
  return uniqueKey(input.key);
}
