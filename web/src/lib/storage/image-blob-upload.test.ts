import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/blob", () => ({ put: vi.fn(), del: vi.fn() }));

import {
  deleteBlobImageIfOurs,
  effectiveMimeType,
  inferMimeFromName,
  safeImageExtension,
  uploadImageToBlobStorage,
} from "./image-blob-upload";

describe("inferMimeFromName / effectiveMimeType", () => {
  it("infers common extensions", () => {
    expect(inferMimeFromName("photo.JPG")).toBe("image/jpeg");
    expect(inferMimeFromName("a.heic")).toBe("image/heic");
    expect(inferMimeFromName("logo.svg")).toBe("image/svg+xml");
    expect(inferMimeFromName("mystery.bin")).toBe("");
  });
  it("prefers the file's own type, falls back to the name for octet-stream", () => {
    const typed = new File([""], "x.png", { type: "image/webp" });
    expect(effectiveMimeType(typed)).toBe("image/webp");
    const untyped = new File([""], "x.png", { type: "application/octet-stream" });
    expect(effectiveMimeType(untyped)).toBe("image/png");
  });
});

describe("safeImageExtension", () => {
  it("uses the filename extension when recognized", () => {
    expect(safeImageExtension("a.webp", "image/png")).toBe("webp");
    expect(safeImageExtension("a.jpg", "")).toBe("jpeg");
  });
  it("falls back to the mime, then png", () => {
    expect(safeImageExtension("noext", "image/jpeg")).toBe("jpg");
    expect(safeImageExtension("noext", "")).toBe("png");
  });
});

describe("uploadImageToBlobStorage (local provider)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("stores under the configured dir, returns an /api/files URL, and cleans up the old file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "upload-"));
    vi.stubEnv("STORAGE_PROVIDER", "local");
    vi.stubEnv("STORAGE_LOCAL_DIR", dir);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    const file = new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" });

    const first = await uploadImageToBlobStorage({
      pathPrefix: "logos", key: "u1", file, oldUrl: null, maxBytes: 1024,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.url).toMatch(/^http:\/\/localhost:3000\/api\/files\/logos\/u1-\d+-[0-9a-f]{8}\.png$/);
    expect(fs.readdirSync(path.join(dir, "logos"))).toHaveLength(1);

    const second = await uploadImageToBlobStorage({
      pathPrefix: "logos", key: "u1", file, oldUrl: first.url, maxBytes: 1024,
    });
    expect(second.ok).toBe(true);
    expect(fs.readdirSync(path.join(dir, "logos"))).toHaveLength(1);

    if (second.ok) await deleteBlobImageIfOurs(second.url);
    expect(fs.readdirSync(path.join(dir, "logos"))).toHaveLength(0);
  });

  it("rejects bad types and oversize files", async () => {
    vi.stubEnv("STORAGE_PROVIDER", "local");
    const bad = await uploadImageToBlobStorage({
      pathPrefix: "p", key: "k", file: new File(["x"], "a.txt", { type: "text/plain" }), oldUrl: null, maxBytes: 10,
    });
    expect(bad).toMatchObject({ ok: false });
    const big = await uploadImageToBlobStorage({
      pathPrefix: "p", key: "k", file: new File(["xxxxxxxx"], "a.png", { type: "image/png" }), oldUrl: null, maxBytes: 2,
    });
    expect(big).toMatchObject({ ok: false, error: expect.stringContaining("too large") });
  });
});
