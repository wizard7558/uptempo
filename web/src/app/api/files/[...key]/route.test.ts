import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/blob", () => ({ put: vi.fn(), del: vi.fn() }));

import { signPrivateKey } from "@/lib/providers/storage/signing";
import { GET } from "./route";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "files-route-"));
  vi.stubEnv("STORAGE_PROVIDER", "local");
  vi.stubEnv("STORAGE_LOCAL_DIR", dir);
  vi.stubEnv("BOOKING_SESSION_SECRET", "test-secret");
  fs.mkdirSync(path.join(dir, "logos"), { recursive: true });
  fs.mkdirSync(path.join(dir, "private", "ids"), { recursive: true });
  fs.writeFileSync(path.join(dir, "logos", "a.png"), Buffer.from([137, 80, 78, 71]));
  fs.writeFileSync(path.join(dir, "logos", "b.svg"), "<svg/>");
  fs.writeFileSync(path.join(dir, "logos", "c.webp"), "w");
  fs.writeFileSync(path.join(dir, "private", "ids", "p.jpg"), "secret-bytes");
  fs.writeFileSync(path.join(path.dirname(dir), "outside-secret.txt"), "nope");
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(path.join(path.dirname(dir), "outside-secret.txt"), { force: true });
});

function call(segments: string[], query = "") {
  const url = `http://localhost:3000/api/files/${segments.join("/")}${query}`;
  return GET(new Request(url), { params: Promise.resolve({ key: segments }) });
}

describe("GET /api/files/[...key] public files", () => {
  it("serves a file with MIME type, cache and nosniff headers", async () => {
    const res = await call(["logos", "a.png"]);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from([137, 80, 78, 71]));
  });

  it("infers webp and falls back to octet-stream for unknown extensions", async () => {
    expect((await call(["logos", "c.webp"])).headers.get("content-type")).toBe("image/webp");
    fs.writeFileSync(path.join(dir, "logos", "d.bin"), "x");
    expect((await call(["logos", "d.bin"])).headers.get("content-type")).toBe("application/octet-stream");
  });

  it("adds sandboxing CSP for SVG", async () => {
    const res = await call(["logos", "b.svg"]);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
  });

  it("returns 404 for missing files", async () => {
    expect((await call(["logos", "nope.png"])).status).toBe(404);
  });

  it.each([
    [["..", "outside-secret.txt"]],
    [["logos", "..", "..", "outside-secret.txt"]],
    [["logos", "", "a.png"]],
    [["logos", "a\\..\\a.png"]],
    [["%2e%2e", "outside-secret.txt"]],
    [["logos", "..%2f..%2foutside-secret.txt"]],
  ])("rejects traversal %j", async (segments) => {
    expect((await call(segments)).status).toBe(404);
  });

  it("returns 404 when the provider is not local", async () => {
    vi.stubEnv("STORAGE_PROVIDER", "s3");
    expect((await call(["logos", "a.png"])).status).toBe(404);
    vi.stubEnv("STORAGE_PROVIDER", "");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "tok");
    expect((await call(["logos", "a.png"])).status).toBe(404);
  });
});

describe("GET /api/files/private/...", () => {
  const key = "private/ids/p.jpg";
  const segs = key.split("/");

  it("returns 403 without a signature", async () => {
    expect((await call(segs)).status).toBe(403);
  });

  it("returns 200 for a valid, unexpired signature and does not cache", async () => {
    const { exp, sig } = signPrivateKey(key, 60);
    const res = await call(segs, `?exp=${exp}&sig=${sig}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.text()).toBe("secret-bytes");
  });

  it("returns 403 for a tampered signature", async () => {
    const { exp, sig } = signPrivateKey(key, 60);
    const flipped = (sig[0] === "0" ? "1" : "0") + sig.slice(1);
    expect((await call(segs, `?exp=${exp}&sig=${flipped}`)).status).toBe(403);
    expect((await call(segs, `?exp=${exp + 100}&sig=${sig}`)).status).toBe(403);
  });

  it("returns 403 for a signature made for a different key", async () => {
    fs.writeFileSync(path.join(dir, "private", "ids", "q.jpg"), "other");
    const { exp, sig } = signPrivateKey(key, 60);
    expect((await call(["private", "ids", "q.jpg"], `?exp=${exp}&sig=${sig}`)).status).toBe(403);
  });

  it("returns 403 for an expired URL", async () => {
    const { exp, sig } = signPrivateKey(key, 60, Date.now() - 120_000);
    expect((await call(segs, `?exp=${exp}&sig=${sig}`)).status).toBe(403);
  });
});
