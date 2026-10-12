import { AwsClient } from "aws4fetch";
import {
  type StorageProvider,
  assertSafeKey,
  resolveStoredKey,
} from "./types";

type S3Env = Partial<
  Record<
    | "S3_ENDPOINT"
    | "S3_REGION"
    | "S3_BUCKET"
    | "S3_ACCESS_KEY_ID"
    | "S3_SECRET_ACCESS_KEY"
    | "S3_PUBLIC_URL"
    | "S3_FORCE_PATH_STYLE",
    string | undefined
  >
>;

function readS3Env(): S3Env {
  return {
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_REGION: process.env.S3_REGION,
    S3_BUCKET: process.env.S3_BUCKET,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    S3_PUBLIC_URL: process.env.S3_PUBLIC_URL,
    S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE,
  };
}

const REQUIRED = [
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_PUBLIC_URL",
] as const;

function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

/** S3-compatible storage (AWS, R2, MinIO) via aws4fetch. */
export function createS3Provider(getEnv: () => S3Env = readS3Env): StorageProvider {
  const trim = (v: string | undefined) => v?.trim().replace(/\/+$/, "") ?? "";

  function objectUrl(e: S3Env, key: string): string {
    const endpoint = trim(e.S3_ENDPOINT);
    const bucket = e.S3_BUCKET!.trim();
    const pathStyle = (e.S3_FORCE_PATH_STYLE ?? "true").trim().toLowerCase() !== "false";
    if (pathStyle) return `${endpoint}/${bucket}/${encodeKey(key)}`;
    const u = new URL(endpoint);
    return `${u.protocol}//${bucket}.${u.host}/${encodeKey(key)}`;
  }

  function client(e: S3Env): AwsClient {
    return new AwsClient({
      accessKeyId: e.S3_ACCESS_KEY_ID!.trim(),
      secretAccessKey: e.S3_SECRET_ACCESS_KEY!.trim(),
      region: e.S3_REGION?.trim() || "auto",
      service: "s3",
      retries: 2,
    });
  }

  function configError(): string | null {
    const e = getEnv();
    const missing = REQUIRED.filter((n) => !e[n]?.trim());
    return missing.length
      ? `Storage is not configured (missing ${missing.join(", ")}).`
      : null;
  }

  function keyFromUrl(url: string | null | undefined): string | null {
    if (!url) return null;
    const publicBase = trim(getEnv().S3_PUBLIC_URL);
    if (!publicBase || !url.startsWith(`${publicBase}/`)) return null;
    const rest = url.slice(publicBase.length + 1).split("?")[0];
    return rest ? decodeURIComponent(rest) : null;
  }

  async function removeKey(key: string): Promise<void> {
    if (configError()) return;
    const e = getEnv();
    const res = await client(e).fetch(objectUrl(e, key), { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(`S3 delete failed (${res.status})`);
  }

  return {
    id: "s3",
    configError,
    async put({ key, body, contentType, visibility }) {
      const err = configError();
      if (err) throw new Error(err);
      const e = getEnv();
      const stored = resolveStoredKey({ key, visibility });
      const res = await client(e).fetch(objectUrl(e, stored), {
        method: "PUT",
        body,
        headers: { "Content-Type": contentType },
      });
      if (!res.ok) throw new Error(`S3 upload failed (${res.status})`);
      return { url: `${trim(e.S3_PUBLIC_URL)}/${encodeKey(stored)}`, key: stored };
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
      const err = configError();
      if (err) throw new Error(err);
      const e = getEnv();
      const u = new URL(objectUrl(e, key));
      u.searchParams.set("X-Amz-Expires", String(Math.max(1, Math.floor(ttlSeconds))));
      const signed = await client(e).sign(u.toString(), {
        method: "GET",
        aws: { signQuery: true },
      });
      return signed.url;
    },
  };
}
