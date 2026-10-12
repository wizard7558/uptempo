import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createS3Provider } from "./s3";

const env = {
  S3_ENDPOINT: "https://s3.example.com/",
  S3_REGION: "us-east-1",
  S3_BUCKET: "bkt",
  S3_ACCESS_KEY_ID: "AKIATEST",
  S3_SECRET_ACCESS_KEY: "secret",
  S3_PUBLIC_URL: "https://cdn.example.com",
};

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function lastRequest(): Request {
  return fetchMock.mock.calls.at(-1)![0] as Request;
}

describe("s3 provider", () => {
  it("reports missing config", () => {
    expect(createS3Provider(() => ({})).configError()).toMatch(/S3_ENDPOINT.*S3_BUCKET/);
    expect(createS3Provider(() => env).configError()).toBeNull();
  });

  it("PUTs path-style with a SigV4 authorization header and returns the public URL", async () => {
    const p = createS3Provider(() => env);
    const { url, key } = await p.put({ key: "logos/u1.png", body: new Blob(["x"]), contentType: "image/png" });
    const req = lastRequest();
    expect(req.method).toBe("PUT");
    expect(req.url).toBe(`https://s3.example.com/bkt/${key}`);
    expect(req.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(req.headers.get("content-type")).toBe("image/png");
    expect(url).toBe(`https://cdn.example.com/${key}`);
    expect(p.owns(url)).toBe(true);
    expect(p.owns("https://other.com/x.png")).toBe(false);
  });

  it("supports virtual-hosted style when S3_FORCE_PATH_STYLE=false", async () => {
    const p = createS3Provider(() => ({ ...env, S3_FORCE_PATH_STYLE: "false" }));
    const { key } = await p.put({ key: "a.png", body: new Blob(["x"]), contentType: "image/png" });
    expect(lastRequest().url).toBe(`https://bkt.s3.example.com/${key}`);
  });

  it("throws when the upload fails", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 403 }));
    await expect(
      createS3Provider(() => env).put({ key: "a.png", body: new Blob(["x"]), contentType: "image/png" }),
    ).rejects.toThrow("S3 upload failed (403)");
  });

  it("DELETEs the key derived from the public URL and ignores foreign URLs", async () => {
    const p = createS3Provider(() => env);
    await p.delete("https://cdn.example.com/logos/a.png");
    const req = lastRequest();
    expect(req.method).toBe("DELETE");
    expect(req.url).toBe("https://s3.example.com/bkt/logos/a.png");
    fetchMock.mockClear();
    await p.delete("https://other.com/logos/a.png");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("puts private objects under private/ and presigns GET urls", async () => {
    const p = createS3Provider(() => env);
    const { key } = await p.put({ key: "ids/a.jpg", body: new Blob(["x"]), contentType: "image/jpeg", visibility: "private" });
    expect(key.startsWith("private/ids/a-")).toBe(true);
    expect(lastRequest().url).toBe(`https://s3.example.com/bkt/${key}`);
    const signed = new URL(await p.getSignedReadUrl(key, 300));
    expect(signed.pathname).toBe(`/bkt/${key}`);
    expect(signed.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(signed.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(signed.searchParams.get("X-Amz-Signature")).toBeTruthy();
  });

  it("refuses public keys under private/ and traversal", async () => {
    const p = createS3Provider(() => env);
    await expect(p.put({ key: "private/a.png", body: new Blob(["x"]), contentType: "image/png" })).rejects.toThrow(/private\//);
    await expect(p.getSignedReadUrl("../x", 60)).rejects.toThrow(/Invalid storage key/);
  });
});
