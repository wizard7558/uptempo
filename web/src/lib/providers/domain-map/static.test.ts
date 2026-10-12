import { afterEach, describe, expect, it, vi } from "vitest";
import { createStaticReader, parseDomainMap } from "./static";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parseDomainMap", () => {
  it("parses host=slug pairs and ignores blanks", () => {
    const map = parseDomainMap(" Book.Example.com=ada , ,other.test=bee,bad");
    expect(map.get("book.example.com")).toBe("ada");
    expect(map.get("other.test")).toBe("bee");
    expect(map.size).toBe(2);
  });
});

describe("static domain map reader", () => {
  it("looks up a host case-insensitively", async () => {
    vi.stubEnv("UPTEMPO_DOMAIN_MAP", "book.example.com=ada-salon");
    const reader = createStaticReader();
    expect(reader.id).toBe("static");
    expect(await reader.lookup("Book.Example.com")).toBe("ada-salon");
    expect(await reader.lookup("missing.test")).toBeNull();
  });

  it("reparses when the env value changes", async () => {
    vi.stubEnv("UPTEMPO_DOMAIN_MAP", "a.test=one");
    const reader = createStaticReader();
    expect(await reader.lookup("a.test")).toBe("one");
    vi.stubEnv("UPTEMPO_DOMAIN_MAP", "b.test=two");
    expect(await reader.lookup("a.test")).toBeNull();
    expect(await reader.lookup("b.test")).toBe("two");
  });
});
