import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const get = vi.hoisted(() => vi.fn());
vi.mock("@vercel/global-config", () => ({ get }));

import { middleware } from "./middleware";

afterEach(() => {
  get.mockReset();
  vi.unstubAllEnvs();
});

describe("middleware legacy redirect", () => {
  it("does not redirect a detached byrende.com host", async () => {
    const req = new NextRequest("https://byrende.com/quiz?src=flyer", {
      headers: { host: "byrende.com" },
    });
    const res = await middleware(req);
    expect(res.status).not.toBe(308);
    expect(res.headers.get("location")).toBeNull();
  });

  it.each(["/book/demo-salon", "/login", "/api/auth/sign-in/email"])(
    "does not redirect www.byrende.com%s",
    async (path) => {
      const res = await middleware(
        new NextRequest(`https://www.byrende.com${path}`, {
          headers: { host: "www.byrende.com" },
        }),
      );
      expect(res.status).not.toBe(308);
      expect(res.headers.get("location")).toBeNull();
    },
  );

  it("308-redirects apex bookuptempo.com to www", async () => {
    const res = await middleware(
      new NextRequest("https://bookuptempo.com/book/demo-salon?src=1", {
        headers: { host: "bookuptempo.com" },
      }),
    );
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(
      "https://www.bookuptempo.com/book/demo-salon?src=1",
    );
  });

  it.each([
    "/api/stripe/webhook",
    "/api/twilio/status",
    "/api/cron/send-reminders",
    "/api/loopmessage/webhook",
  ])("does not redirect %s on the apex host", async (path) => {
    const res = await middleware(
      new NextRequest(`https://bookuptempo.com${path}`, {
        headers: { host: "bookuptempo.com" },
      }),
    );
    expect(res.status).not.toBe(308);
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("middleware path-based tenant slug", () => {
  it.each([
    ["/book/test-salon", "test-salon"],
    ["/subscribe/test-salon", "test-salon"],
    ["/store/test-salon/cart", "test-salon"],
    ["/q/test-salon", "test-salon"],
    ["/gift/test-salon/balance", "test-salon"],
  ])("%s sets x-tenant-slug", async (path, slug) => {
    const res = await middleware(
      new NextRequest(`https://www.bookuptempo.com${path}`, {
        headers: { host: "www.bookuptempo.com" },
      }),
    );
    expect(res.headers.get("x-middleware-request-x-tenant-slug")).toBe(slug);
  });

  it("rewrites a global-config custom domain root to the booking page", async () => {
    vi.stubEnv("UPTEMPO_MODE", "multi");
    vi.stubEnv("DOMAIN_MAP_PROVIDER", "global-config");
    get.mockResolvedValue({ "book.example.com": "ada-salon" });
    const res = await middleware(
      new NextRequest("https://book.example.com/", { headers: { host: "book.example.com" } }),
    );
    expect(res.headers.get("x-middleware-rewrite")).toContain("/book/ada-salon");
    expect(res.headers.get("x-middleware-request-x-tenant-slug")).toBe("ada-salon");
  });

  it("rewrites a static map custom domain root", async () => {
    vi.stubEnv("UPTEMPO_MODE", "multi");
    vi.stubEnv("DOMAIN_MAP_PROVIDER", "static");
    vi.stubEnv("UPTEMPO_DOMAIN_MAP", "book.example.com=ada-salon");
    const res = await middleware(
      new NextRequest("https://book.example.com/", { headers: { host: "book.example.com" } }),
    );
    expect(get).not.toHaveBeenCalled();
    expect(res.headers.get("x-middleware-rewrite")).toContain("/book/ada-salon");
  });

  it("does not rewrite when the domain map provider is none", async () => {
    vi.stubEnv("UPTEMPO_MODE", "multi");
    vi.stubEnv("DOMAIN_MAP_PROVIDER", "none");
    vi.stubEnv("UPTEMPO_DOMAIN_MAP", "book.example.com=ada-salon");
    vi.stubEnv("GLOBAL_CONFIG", "https://example.invalid");
    const res = await middleware(
      new NextRequest("https://book.example.com/", { headers: { host: "book.example.com" } }),
    );
    expect(get).not.toHaveBeenCalled();
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(res.headers.get("x-middleware-request-x-tenant-slug")).toBeNull();
  });

  it("rewrites / to /single-home in single mode", async () => {
    vi.stubEnv("UPTEMPO_MODE", "single");
    const res = await middleware(
      new NextRequest("https://book.example.com/", {
        headers: { host: "book.example.com" },
      }),
    );
    expect(res.headers.get("x-middleware-rewrite")).toContain("/single-home");
  });

  it.each(["/signup", "/discover"])(
    "307-redirects %s to / in single mode",
    async (path) => {
      vi.stubEnv("UPTEMPO_MODE", "single");
      const res = await middleware(
        new NextRequest(`https://book.example.com${path}`, {
          headers: { host: "book.example.com" },
        }),
      );
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/");
    },
  );

  it("does not set a slug for unrelated paths", async () => {
    const res = await middleware(
      new NextRequest("https://www.bookuptempo.com/quiz", {
        headers: { host: "www.bookuptempo.com" },
      }),
    );
    expect(res.headers.get("x-middleware-request-x-tenant-slug")).toBeNull();
  });

  it("drops a caller-supplied tenant header", async () => {
    const res = await middleware(
      new NextRequest("https://www.bookuptempo.com/dashboard", {
        headers: {
          host: "www.bookuptempo.com",
          "x-tenant-slug": "other-salon",
        },
      }),
    );
    expect(res.headers.get("x-middleware-request-x-tenant-slug")).toBeNull();
  });

  it("replaces a caller-supplied tenant header with the path slug", async () => {
    const res = await middleware(
      new NextRequest("https://www.bookuptempo.com/book/test-salon", {
        headers: {
          host: "www.bookuptempo.com",
          "x-tenant-slug": "other-salon",
        },
      }),
    );
    expect(res.headers.get("x-middleware-request-x-tenant-slug")).toBe("test-salon");
  });

  it("strips a caller-supplied tenant header on API routes", async () => {
    const res = await middleware(
      new NextRequest("https://www.bookuptempo.com/api/health", {
        headers: {
          host: "www.bookuptempo.com",
          "x-tenant-slug": "other-salon",
        },
      }),
    );
    expect(res.headers.get("x-middleware-request-x-tenant-slug")).toBeNull();
  });
});
