import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { resolveStorageProviderId, readProviderEnv } from "@/lib/providers/env";
import { getLocalStorageDir, resolveLocalPath } from "@/lib/providers/storage/local";
import { verifyPrivateKey } from "@/lib/providers/storage/signing";
import { PRIVATE_KEY_PREFIX } from "@/lib/providers/storage/types";
import { inferMimeFromName } from "@/lib/storage/image-blob-upload";

export const dynamic = "force-dynamic";

const notFound = () => new NextResponse("Not found", { status: 404 });

/**
 * Serves files written by the local storage provider. 404 for every other
 * provider. Keys under `private/` are served only with a valid, unexpired
 * HMAC signature (`?exp=&sig=`).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  if (resolveStorageProviderId(readProviderEnv()) !== "local") return notFound();

  const { key: rawSegments } = await params;
  let segments: string[];
  try {
    segments = rawSegments.map((s) => decodeURIComponent(s));
  } catch {
    return notFound();
  }

  const filePath = resolveLocalPath(getLocalStorageDir(), segments);
  if (!filePath) return notFound();

  const key = segments.join("/");
  const isPrivate = key.startsWith(PRIVATE_KEY_PREFIX);
  if (isPrivate) {
    const url = new URL(request.url);
    let ok = false;
    try {
      ok = verifyPrivateKey(key, url.searchParams.get("exp"), url.searchParams.get("sig"));
    } catch {
      return new NextResponse("Private file signing is not configured", { status: 500 });
    }
    if (!ok) return new NextResponse("Forbidden", { status: 403 });
  }

  let data: Buffer;
  try {
    data = await fs.readFile(filePath);
  } catch {
    return notFound();
  }

  const contentType = inferMimeFromName(filePath) || "application/octet-stream";
  const headers = new Headers({
    "Content-Type": contentType,
    "Content-Length": String(data.length),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": isPrivate
      ? "private, no-store"
      : "public, max-age=31536000, immutable",
  });
  if (contentType === "image/svg+xml") {
    headers.set(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
  }
  return new NextResponse(new Uint8Array(data), { status: 200, headers });
}
