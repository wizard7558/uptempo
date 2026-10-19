// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  native: true,
  pathname: "/account",
  router: { replace: vi.fn() },
}));

vi.mock("next/link", () => ({
  default: ({ href, prefetch, ...props }: React.ComponentProps<"a"> & { href: string; prefetch?: boolean }) => {
    void prefetch;
    return <a {...props} href={href} />;
  },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => mocks.router,
}));
vi.mock("@/lib/native/client", () => ({
  isNativeApp: () => mocks.native,
}));

import { NativeTabBar } from "./native-tab-bar";

let cookieDescriptor: PropertyDescriptor | undefined;
let cookieJar = "";
const cookieWrites: string[] = [];

function setCookieJar(initialValue: string) {
  cookieJar = initialValue;
  cookieWrites.length = 0;
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => cookieJar,
    set: (value: string) => {
      cookieWrites.push(value);
      const [pair] = value.split(";");
      const separator = pair.indexOf("=");
      if (separator < 0) return;

      const name = pair.slice(0, separator);
      const existing = cookieJar
        .split(/;\s*/)
        .filter(Boolean)
        .filter((cookie) => !cookie.startsWith(`${name}=`));
      existing.push(pair);
      cookieJar = existing.join("; ");
    },
  });
}

function renderTabBar(pathname: string, cookies = "") {
  mocks.pathname = pathname;
  setCookieJar(cookies);
  return render(<NativeTabBar />);
}

function expectBusinessLinks(slug: string) {
  expect(screen.getByRole("link", { name: "Book" }).getAttribute("href")).toBe(
    slug ? `/book/${slug}` : "/discover",
  );
  expect(screen.getByRole("link", { name: "Shop" }).getAttribute("href")).toBe(
    slug ? `/store/${slug}` : "/discover",
  );
}

beforeEach(() => {
  cookieDescriptor = Object.getOwnPropertyDescriptor(document, "cookie");
  mocks.native = true;
  mocks.pathname = "/account";
  mocks.router.replace.mockReset();
  sessionStorage.clear();
  setCookieJar("");
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  if (cookieDescriptor) {
    Object.defineProperty(document, "cookie", cookieDescriptor);
  } else {
    Reflect.deleteProperty(document, "cookie");
  }
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("NativeTabBar remembered business cookies", () => {
  it("uses the canonical business cookie", async () => {
    renderTabBar("/account", "uptempo_last_business=canonical%20business");

    await waitFor(() => expectBusinessLinks("canonical business"));
  });

  it("falls back to the legacy salon cookie when the canonical cookie is absent", async () => {
    renderTabBar("/account", "uptempo_last_salon=legacy-business");

    await waitFor(() => expectBusinessLinks("legacy-business"));
  });

  it("prefers the canonical cookie when both values differ", async () => {
    renderTabBar(
      "/account",
      "uptempo_last_business=canonical-business; uptempo_last_salon=legacy-business",
    );

    await waitFor(() => expectBusinessLinks("canonical-business"));
  });

  it.each([
    ["empty", "uptempo_last_business=; uptempo_last_salon=legacy-business"],
    ["malformed", "uptempo_last_business=%E0%A4%A; uptempo_last_salon=legacy-business"],
  ])("falls back to the legacy cookie when the canonical value is %s", async (_kind, cookies) => {
    renderTabBar("/account", cookies);

    await waitFor(() => expectBusinessLinks("legacy-business"));
  });

  it("treats a malformed legacy cookie as missing", async () => {
    renderTabBar("/discover", "uptempo_last_salon=%E0%A4%A");

    await waitFor(() => {
      expect(screen.getByRole("navigation", { name: "App navigation" })).toBeTruthy();
      expectBusinessLinks("");
    });
    expect(mocks.router.replace).not.toHaveBeenCalled();
  });

  it("overwrites both cookie names from a business path and uses that business for links", async () => {
    renderTabBar(
      "/book/path%20business",
      "uptempo_last_business=old-business; uptempo_last_salon=older-business",
    );

    await waitFor(() => expectBusinessLinks("path business"));
    const attributes = "path=/;max-age=31536000;samesite=lax";
    expect(cookieWrites).toEqual([
      `uptempo_last_business=path%20business;${attributes}`,
      `uptempo_last_salon=path%20business;${attributes}`,
    ]);
  });

  it.each([
    ["canonical", "uptempo_last_business=remembered-business"],
    ["legacy fallback", "uptempo_last_salon=remembered-business"],
  ])("redirects from discover once using the %s cookie", async (_source, cookies) => {
    const view = renderTabBar("/discover", cookies);

    await waitFor(() =>
      expect(mocks.router.replace).toHaveBeenCalledWith("/book/remembered-business"),
    );
    expect(mocks.router.replace).toHaveBeenCalledTimes(1);

    mocks.pathname = "/account";
    view.rerender(<NativeTabBar />);
    mocks.pathname = "/discover";
    view.rerender(<NativeTabBar />);
    expect(mocks.router.replace).toHaveBeenCalledTimes(1);
  });

  it("hides navigation on the web", async () => {
    mocks.native = false;
    renderTabBar("/account");

    await waitFor(() =>
      expect(screen.queryByRole("navigation", { name: "App navigation" })).toBeNull(),
    );
  });
});
