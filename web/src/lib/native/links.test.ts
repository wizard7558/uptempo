// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/dom";
import {
  handleNativeDeepLinks,
  resolveNativeLink,
  safeNativeLocalPath,
} from "./links";

function setNativeApp(plugins: Record<string, unknown>) {
  Object.defineProperty(window, "Capacitor", {
    configurable: true,
    value: { isNativePlatform: () => true, Plugins: plugins },
  });
}

afterEach(() => {
  Reflect.deleteProperty(window, "Capacitor");
  Reflect.deleteProperty(window, "__UPTEMPO_NATIVE_APP__");
  Reflect.deleteProperty(window, "__UPTEMPO_NATIVE_LAUNCH_ID__");
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

function setLaunchId(value?: string) {
  if (value) {
    Object.defineProperty(window, "__UPTEMPO_NATIVE_LAUNCH_ID__", {
      configurable: true,
      value,
    });
  } else {
    Reflect.deleteProperty(window, "__UPTEMPO_NATIVE_LAUNCH_ID__");
  }
}

describe("native Universal Links and callback URLs", () => {
  it("maps trusted cold and warm Universal Links to local paths", () => {
    expect(
      resolveNativeLink(
        "https://bookuptempo.com/book/demo?service=cut#times",
      ),
    ).toEqual({
      path: "/book/demo?service=cut#times",
      closeBrowser: false,
    });
    expect(
      resolveNativeLink(
        "https://www.bookuptempo.com/settings/calendars?connected=1",
      ),
    ).toEqual({
      path: "/settings/calendars?connected=1",
      closeBrowser: false,
    });
  });

  it("maps only fixed owner and client OAuth callback targets", () => {
    expect(
      resolveNativeLink(
        "uptempo-owner://calendar-callback?connected=abc",
      ),
    ).toEqual({
      path: "/settings/calendars?connected=abc",
      closeBrowser: true,
    });
    expect(
      resolveNativeLink("uptempo-client://connect-callback?stripe_setup=complete"),
    ).toEqual({
      path: "/settings/billing?stripe_setup=complete",
      closeBrowser: true,
    });
    expect(resolveNativeLink("uptempo-owner://unlisted-callback")).toBeNull();
    expect(
      resolveNativeLink("uptempo-owner://calendar-callback/../../outside"),
    ).toBeNull();
  });

  it("rejects a custom callback scheme belonging to the other native app", () => {
    expect(
      resolveNativeLink("uptempo-owner://calendar-callback", "client"),
    ).toBeNull();
    expect(
      resolveNativeLink("uptempo-client://connect-callback", "owner"),
    ).toBeNull();
    expect(
      resolveNativeLink("uptempo-owner://calendar-callback", "owner")?.path,
    ).toBe("/settings/calendars");
  });

  it("uses the app identity injected by the native document bootstrap", () => {
    Object.defineProperty(window, "__UPTEMPO_NATIVE_APP__", {
      configurable: true,
      value: "client",
    });

    expect(resolveNativeLink("uptempo-owner://calendar-callback")).toBeNull();
    expect(
      resolveNativeLink("uptempo-client://connect-callback")?.path,
    ).toBe("/settings/billing");
  });

  it.each([
    "http://www.bookuptempo.com/book/demo",
    "https://bookuptempo.com.evil.test/book/demo",
    "https://www.bookuptempo.com:443/book/demo",
    "https://user@www.bookuptempo.com/book/demo",
    "https://www.bookuptempo.com\\@evil.test/book/demo",
    "https://www.bookuptempo.com/book/%5C%5Cevil",
    "https://www.bookuptempo.com/book/demo%0a",
    "//www.bookuptempo.com/book/demo",
    "javascript:alert(1)",
  ])("rejects untrusted or malformed URL %s", (url) => {
    expect(resolveNativeLink(url)).toBeNull();
  });

  it("rejects unsafe notification paths and accepts local paths", () => {
    expect(safeNativeLocalPath("/account?tab=appointments#upcoming")).toBe(
      "/account?tab=appointments#upcoming",
    );
    for (const path of [
      "//evil.test/path",
      "/\\evil.test/path",
      "/%5Cevil.test/path",
      "/%2F%2Fevil.test/path",
      "/%0aevil",
      "https://evil.test/path",
    ]) {
      expect(safeNativeLocalPath(path)).toBeNull();
    }
  });

  it("handles a launch URL and a later appUrlOpen callback, closing Browser for callbacks", async () => {
    const navigate = vi.fn();
    const closeBrowser = vi.fn(async () => {});
    let onAppUrlOpen: ((data: { url: string }) => void) | undefined;
    const remove = vi.fn();
    const app = {
      getLaunchUrl: vi.fn(async () => ({
        url: "https://bookuptempo.com/book/demo?ref=notification",
      })),
      addListener: vi.fn(
        (_event: string, callback: (data: { url: string }) => void) => {
          onAppUrlOpen = callback;
          return { remove };
        },
      ),
    };
    setNativeApp({ App: app });
    setLaunchId("legacy-test-process-1");

    const stop = handleNativeDeepLinks(undefined, { navigate, closeBrowser });
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        "/book/demo?ref=notification",
      ),
    );

    onAppUrlOpen?.({
      url: "uptempo-owner://connect-callback?stripe_setup=complete",
    });
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        "/settings/billing?stripe_setup=complete",
      ),
    );
    expect(closeBrowser).toHaveBeenCalledTimes(1);
    stop();
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
  });

  it("consumes the retained cold URL once across handler remounts for one process", async () => {
    const navigate = vi.fn();
    const app = {
      getLaunchUrl: vi.fn(async () => ({
        url: "https://bookuptempo.com/book/demo?code=not-stored",
      })),
      addListener: vi.fn(() => ({ remove: vi.fn() })),
    };
    setNativeApp({ App: app });
    setLaunchId("process-id-one");

    const stopFirst = handleNativeDeepLinks(undefined, { navigate });
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    stopFirst();

    const stopSecond = handleNativeDeepLinks(undefined, { navigate });
    await waitFor(() => expect(app.getLaunchUrl).toHaveBeenCalledTimes(2));
    await Promise.resolve();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem("uptempo.native.cold-launch-process"))
      .toBe("process-id-one");
    expect(window.sessionStorage.getItem("uptempo.native.cold-launch-process"))
      .not.toContain("not-stored");
    stopSecond();
  });

  it("allows the same retained cold URL in a new native process", async () => {
    const navigate = vi.fn();
    const app = {
      getLaunchUrl: vi.fn(async () => ({ url: "https://bookuptempo.com/book/demo" })),
      addListener: vi.fn(() => ({ remove: vi.fn() })),
    };
    setNativeApp({ App: app });
    setLaunchId("process-id-one");

    const stopFirst = handleNativeDeepLinks(undefined, { navigate });
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    stopFirst();

    setLaunchId("process-id-two");
    const stopSecond = handleNativeDeepLinks(undefined, { navigate });
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(2));
    expect(window.sessionStorage.getItem("uptempo.native.cold-launch-process"))
      .toBe("process-id-two");
    stopSecond();
  });

  it("does not reload when a cold launch already matches the current local route", async () => {
    window.history.replaceState(null, "", "/book/demo?source=mail");
    setLaunchId("process-already-at-target");
    const navigate = vi.fn();
    const app = {
      getLaunchUrl: vi.fn(async () => ({
        url: "https://bookuptempo.com/book/demo?source=mail",
      })),
      addListener: vi.fn(() => ({ remove: vi.fn() })),
    };
    setNativeApp({ App: app });

    const stop = handleNativeDeepLinks(undefined, { navigate });
    await waitFor(() => expect(app.getLaunchUrl).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(navigate).not.toHaveBeenCalled();
    stop();
  });

  it("allows a repeated warm URL after the user navigates away", async () => {
    let onAppUrlOpen: ((data: { url: string }) => void) | undefined;
    const navigate = vi.fn();
    const app = {
      getLaunchUrl: vi.fn(async () => null),
      addListener: vi.fn((_event: string, callback: typeof onAppUrlOpen) => {
        onAppUrlOpen = callback;
        return { remove: vi.fn() };
      }),
    };
    setNativeApp({ App: app });
    const stop = handleNativeDeepLinks(undefined, { navigate });
    const url = "https://bookuptempo.com/book/demo";

    onAppUrlOpen?.({ url });
    expect(navigate).toHaveBeenCalledTimes(1);
    window.history.replaceState(null, "", "/discover");
    onAppUrlOpen?.({ url });

    expect(navigate).toHaveBeenCalledTimes(2);
    stop();
  });

  it("deduplicates concurrent cold and warm delivery of the same link", async () => {
    let resolveLaunch!: (value: { url: string }) => void;
    let onAppUrlOpen: ((data: { url: string }) => void) | undefined;
    const navigate = vi.fn();
    const url = "https://bookuptempo.com/book/concurrent";
    const app = {
      getLaunchUrl: vi.fn(
        () => new Promise<{ url: string }>((resolve) => { resolveLaunch = resolve; }),
      ),
      addListener: vi.fn((_event: string, callback: typeof onAppUrlOpen) => {
        onAppUrlOpen = callback;
        return { remove: vi.fn() };
      }),
    };
    setNativeApp({ App: app });
    setLaunchId("process-concurrent");
    const stop = handleNativeDeepLinks(undefined, { navigate });

    onAppUrlOpen?.({ url });
    resolveLaunch({ url });
    await waitFor(() => expect(app.getLaunchUrl).toHaveBeenCalledTimes(1));
    await Promise.resolve();

    expect(navigate).toHaveBeenCalledTimes(1);
    stop();
  });

  it("uses location equality safely when launch identity storage is unavailable", async () => {
    const originalGetItem = Storage.prototype.getItem;
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (
      this: Storage,
      key: string,
    ) {
      if (key === "uptempo.native.cold-launch-process") {
        throw new Error("storage denied");
      }
      return originalGetItem.call(this, key);
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === "uptempo.native.cold-launch-process") {
        throw new Error("storage denied");
      }
      return originalSetItem.call(this, key, value);
    });

    const navigate = vi.fn();
    const app = {
      getLaunchUrl: vi.fn(async () => ({
        url: "https://bookuptempo.com/book/storage-fallback",
      })),
      addListener: vi.fn(() => ({ remove: vi.fn() })),
    };
    setNativeApp({ App: app });
    setLaunchId("storage-denied-process-one");

    const stopFirst = handleNativeDeepLinks(undefined, { navigate });
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    stopFirst();

    window.history.replaceState(null, "", "/book/storage-fallback");
    setLaunchId("storage-denied-process-two");
    const stopSecond = handleNativeDeepLinks(undefined, { navigate });
    await waitFor(() => expect(app.getLaunchUrl).toHaveBeenCalledTimes(2));
    await Promise.resolve();

    expect(navigate).toHaveBeenCalledTimes(1);
    stopSecond();
  });
});
