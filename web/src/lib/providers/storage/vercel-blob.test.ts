import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/blob", () => ({ put: vi.fn(), del: vi.fn() }));

import { del, put } from "@vercel/blob";
import {
  createVercelBlobProvider,
  isVercelBlobUrl,
  normalizeEnvToken,
} from "./vercel-blob";

describe("normalizeEnvToken", () => {
  it("strips wrapping quotes and whitespace", () => {
    expect(normalizeEnvToken('  "tok_123"  ')).toBe("tok_123");
    expect(normalizeEnvToken("'tok_123'")).toBe("tok_123");
    expect(normalizeEnvToken("tok_123\n")).toBe("tok_123");
  });
  it("returns undefined for empty/missing values", () => {
    expect(normalizeEnvToken(undefined)).toBeUndefined();
    expect(normalizeEnvToken('""')).toBeUndefined();
    expect(normalizeEnvToken("  ")).toBeUndefined();
  });
});

describe("isVercelBlobUrl", () => {
  it("matches only our blob-store hosts", () => {
    expect(
      isVercelBlobUrl("https://abc123.public.blob.vercel-storage.com/products/x.jpg"),
    ).toBe(true);
    expect(isVercelBlobUrl("https://k18hair.com/img.jpg")).toBe(false);
    expect(isVercelBlobUrl("https://evil.com/blob.vercel-storage.com/x")).toBe(false);
    expect(isVercelBlobUrl(null)).toBe(false);
  });
});

describe("vercel-blob provider", () => {
  beforeEach(() => {
    vi.mocked(put).mockReset();
    vi.mocked(del).mockReset();
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", '"tok"');
  });
  afterEach(() => vi.unstubAllEnvs());

  it("reports a config error without a token", () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    expect(createVercelBlobProvider().configError()).toMatch(/BLOB_READ_WRITE_TOKEN/);
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "tok");
    expect(createVercelBlobProvider().configError()).toBeNull();
  });

  it("puts public blobs with a random suffix and the normalized token", async () => {
    vi.mocked(put).mockResolvedValue({ url: "https://s.public.blob.vercel-storage.com/logos/a.png" } as never);
    const res = await createVercelBlobProvider().put({
      key: "logos/a.png", body: new Blob(["x"]), contentType: "image/png",
    });
    expect(res.url).toBe("https://s.public.blob.vercel-storage.com/logos/a.png");
    expect(put).toHaveBeenCalledWith(
      expect.stringMatching(/^logos\/a-\d+-[0-9a-f]{8}\.png$/),
      expect.any(Blob),
      expect.objectContaining({ access: "public", addRandomSuffix: true, token: "tok" }),
    );
  });

  it("only deletes URLs in our store", async () => {
    const p = createVercelBlobProvider();
    await p.delete("https://evil.com/x.png");
    expect(del).not.toHaveBeenCalled();
    await p.delete("https://s.public.blob.vercel-storage.com/x.png");
    expect(del).toHaveBeenCalledWith("https://s.public.blob.vercel-storage.com/x.png", { token: "tok" });
  });

  it("does not support private objects", async () => {
    const p = createVercelBlobProvider();
    await expect(
      p.put({ key: "id/a.png", body: new Blob(["x"]), contentType: "image/png", visibility: "private" }),
    ).rejects.toThrow("Private files require STORAGE_PROVIDER=s3 or local");
    await expect(p.getSignedReadUrl("private/a.png", 60)).rejects.toThrow(
      "Private files require STORAGE_PROVIDER=s3 or local",
    );
    expect(put).not.toHaveBeenCalled();
  });

  it("refuses public keys under private/", async () => {
    await expect(
      createVercelBlobProvider().put({ key: "private/a.png", body: new Blob(["x"]), contentType: "image/png" }),
    ).rejects.toThrow(/private\//);
  });
});
