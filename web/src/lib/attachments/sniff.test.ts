import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES, sniffMime } from "./sniff";

const pad = (b: number[], n = 32) => Buffer.concat([Buffer.from(b), Buffer.alloc(n)]);
const ftyp = (brand: string) =>
  Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftyp"), Buffer.from(brand), Buffer.alloc(12)]);

describe("sniffMime", () => {
  it("detects each allowed signature", () => {
    expect(sniffMime(pad([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMime(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffMime(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]))).toBe(
      "image/webp",
    );
    expect(sniffMime(Buffer.from("%PDF-1.7\n"))).toBe("application/pdf");
    expect(sniffMime(ftyp("heic"))).toBe("image/heic");
    expect(sniffMime(ftyp("heix"))).toBe("image/heic");
    expect(sniffMime(ftyp("mif1"))).toBe("image/heif");
    expect(sniffMime(ftyp("msf1"))).toBe("image/heif");
    expect(sniffMime(ftyp("heif"))).toBe("image/heif");
  });

  it("rejects everything else", () => {
    expect(sniffMime(Buffer.from("hello world, plain text"))).toBeNull();
    expect(sniffMime(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffMime(Buffer.from("RIFF....WAVEfmt "))).toBeNull();
    expect(sniffMime(ftyp("mp42"))).toBeNull();
    expect(sniffMime(Buffer.alloc(0))).toBeNull();
    expect(sniffMime(Buffer.from([0xff, 0xd8]))).toBeNull();
  });

  it("caps uploads at 7 MB", () => {
    expect(MAX_UPLOAD_BYTES).toBe(7 * 1024 * 1024);
  });
});
