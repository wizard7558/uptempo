import { readProviderEnv, resolveStorageProviderId } from "../env";
import { createLocalProvider } from "./local";
import { createS3Provider } from "./s3";
import type { StorageProvider } from "./types";
import { createVercelBlobProvider } from "./vercel-blob";

export type { StorageProvider, StorageProviderId } from "./types";

/** Selects the storage backend from env on every call (cheap; no module-level state). */
export function getStorageProvider(): StorageProvider {
  switch (resolveStorageProviderId(readProviderEnv())) {
    case "vercel-blob":
      return createVercelBlobProvider();
    case "s3":
      return createS3Provider();
    default:
      return createLocalProvider();
  }
}
