import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalProvider, resolveLocalPath } from "./local";
import { signPrivateKey, verifyPrivateKey } from "./signing";

let dir: string;
const provider = () => createLocalProvider({ dir, baseUrl: () => "http://localhost:3000" });
const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "local-storage-"));
  vi.stubEnv("BOOKING_SESSION_SECRET", "test-secret");
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("local provider", () => {
  it("puts a file, returns an /api/files URL, owns it, and deletes it", async () => {
    const p = provider();
    expect(p.configError()).toBeNull();
    const { url, key } = await p.put({ key: "logos/u1.png", body: png(), contentType: "image/png" });
    expect(url).toBe(`http://localhost:3000/api/files/${key}`);
    expect(key).toMatch(/^logos\/u1-\d+-[0-9a-f]{8}\.png$/);
    expect(fs.existsSync(path.join(dir, key))).toBe(true);
    expect(p.owns(url)).toBe(true);
    await p.delete(url);
    expect(fs.existsSync(path.join(dir, key))).toBe(false);
  });

  it("deletes a private file by key and ignores a missing one", async () => {
    const p = provider();
    const { key } = await p.put({ key: "t/a/b.png", body: png(), contentType: "image/png", visibility: "private" });
    expect(fs.existsSync(path.join(dir, key))).toBe(true);
    await p.deleteByKey(key);
    expect(fs.existsSync(path.join(dir, key))).toBe(false);
    await expect(p.deleteByKey(key)).resolves.toBeUndefined();
    await expect(p.deleteByKey("../x")).rejects.toThrow();
  });

  it("does not own foreign hosts or non-files paths", () => {
    const p = provider();
    expect(p.owns("http://evil.com/api/files/x.png")).toBe(false);
    expect(p.owns("http://localhost:3000/other/x.png")).toBe(false);
    expect(p.owns(null)).toBe(false);
    expect(p.owns("not a url")).toBe(false);
  });

  it("refuses to delete outside the root", async () => {
    const outside = path.join(path.dirname(dir), "keep.txt");
    fs.writeFileSync(outside, "x");
    await provider().delete("http://localhost:3000/api/files/..%2Fkeep.txt");
    expect(fs.existsSync(outside)).toBe(true);
    fs.rmSync(outside);
  });

  it("rejects unsafe keys and public keys under private/", async () => {
    const p = provider();
    for (const key of ["../x.png", "a/../x.png", "/abs.png", "a//b.png", "a\\b.png", ""]) {
      await expect(p.put({ key, body: png(), contentType: "image/png" })).rejects.toThrow(/Invalid storage key/);
    }
    await expect(p.put({ key: "private/x.png", body: png(), contentType: "image/png" })).rejects.toThrow(/private\//);
  });

  it("stores private files under private/ and signs read URLs", async () => {
    const p = provider();
    const { key } = await p.put({ key: "ids/a.jpg", body: png(), contentType: "image/jpeg", visibility: "private" });
    expect(key.startsWith("private/ids/a-")).toBe(true);
    expect(fs.existsSync(path.join(dir, key))).toBe(true);
    const signed = new URL(await p.getSignedReadUrl(key, 60));
    expect(signed.pathname).toBe(`/api/files/${key}`);
    expect(verifyPrivateKey(key, signed.searchParams.get("exp"), signed.searchParams.get("sig"))).toBe(true);
  });
});

describe("resolveLocalPath", () => {
  it("accepts nested segments and rejects traversal", () => {
    expect(resolveLocalPath("/r", ["a", "b.png"])).toBe(path.join("/r", "a", "b.png"));
    expect(resolveLocalPath("/r", [])).toBeNull();
    expect(resolveLocalPath("/r", ["a", ".."])).toBeNull();
    expect(resolveLocalPath("/r", [""])).toBeNull();
    expect(resolveLocalPath("/r", ["a\\b"])).toBeNull();
    expect(resolveLocalPath("/r", ["a/b"])).toBeNull();
  });
});

describe("signing", () => {
  it("rejects tampered, expired and malformed signatures", () => {
    const now = 1_700_000_000_000;
    const { exp, sig } = signPrivateKey("private/a.jpg", 60, now);
    expect(verifyPrivateKey("private/a.jpg", String(exp), sig, now)).toBe(true);
    expect(verifyPrivateKey("private/b.jpg", String(exp), sig, now)).toBe(false);
    expect(verifyPrivateKey("private/a.jpg", String(exp + 1), sig, now)).toBe(false);
    expect(verifyPrivateKey("private/a.jpg", String(exp), sig, now + 61_000)).toBe(false);
    expect(verifyPrivateKey("private/a.jpg", String(exp), "zz", now)).toBe(false);
    expect(verifyPrivateKey("private/a.jpg", null, sig, now)).toBe(false);
  });
  it("throws without BOOKING_SESSION_SECRET", () => {
    vi.stubEnv("BOOKING_SESSION_SECRET", "");
    expect(() => signPrivateKey("private/a.jpg", 60)).toThrow(/BOOKING_SESSION_SECRET/);
  });
});
