// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { NativeBridge } from "./native-bridge";
import { notifyNativeAuthSuccess } from "@/lib/native/push-register";

const { routerPushMock, routeState } = vi.hoisted(() => ({
  routerPushMock: vi.fn(),
  routeState: { pathname: "/", search: "" },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
  usePathname: () => routeState.pathname,
  useSearchParams: () => new URLSearchParams(routeState.search),
}));

type PluginEvent = {
  value?: string;
  isActive?: boolean;
  url?: string;
};
type PluginCallback = (event: PluginEvent) => void;

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "Capacitor");
  vi.unstubAllGlobals();
  routerPushMock.mockReset();
  routeState.pathname = "/";
  routeState.search = "";
});

describe("NativeBridge lifecycle", () => {
  it("releases warm-link dedup after navigation completes and the user returns to the original route", async () => {
    const appListeners = new Map<string, Set<PluginCallback>>();
    const app = {
      addListener: vi.fn((event: string, callback: PluginCallback) => {
        const listeners = appListeners.get(event) ?? new Set<PluginCallback>();
        listeners.add(callback);
        appListeners.set(event, listeners);
        return { remove: () => listeners.delete(callback) };
      }),
      getLaunchUrl: vi.fn(async () => null),
    };
    const push = {
      addListener: vi.fn(() => ({ remove: vi.fn() })),
      requestPermissions: vi.fn(async () => ({ receive: "granted" })),
      register: vi.fn(async () => {}),
    };
    Object.defineProperty(window, "Capacitor", {
      configurable: true,
      value: {
        isNativePlatform: () => true,
        Plugins: { App: app, PushNotifications: push },
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    window.history.replaceState(null, "", "/discover");
    routeState.pathname = "/discover";

    const view = render(<NativeBridge />);
    await waitFor(() => expect(appListeners.get("appUrlOpen")?.size).toBe(1));

    const url = "https://www.bookuptempo.com/book/demo";
    const deliver = () => {
      for (const callback of appListeners.get("appUrlOpen") ?? []) {
        callback({ url });
      }
    };
    deliver();
    expect(routerPushMock).toHaveBeenCalledTimes(1);

    window.history.replaceState(null, "", "/book/demo");
    routeState.pathname = "/book/demo";
    view.rerender(<NativeBridge />);
    await waitFor(() => expect(routeState.pathname).toBe("/book/demo"));

    window.history.replaceState(null, "", "/discover");
    routeState.pathname = "/discover";
    view.rerender(<NativeBridge />);
    await waitFor(() => expect(routeState.pathname).toBe("/discover"));

    deliver();
    expect(routerPushMock).toHaveBeenCalledTimes(2);
    expect(routerPushMock).toHaveBeenLastCalledWith("/book/demo");
    view.unmount();
  });

  it("keeps one active listener per native event through StrictMode remounts", async () => {
    const pushListeners = new Map<string, Set<PluginCallback>>();
    const appListeners = new Map<string, Set<PluginCallback>>();
    const addListener = (
      listenersByEvent: Map<string, Set<PluginCallback>>,
      event: string,
      callback: PluginCallback,
    ) => {
      const listeners = listenersByEvent.get(event) ?? new Set<PluginCallback>();
      listeners.add(callback);
      listenersByEvent.set(event, listeners);
      return { remove: () => listeners.delete(callback) };
    };
    const app = {
      addListener: vi.fn((event: string, callback: PluginCallback) =>
        addListener(appListeners, event, callback),
      ),
      getLaunchUrl: vi.fn(async () => null),
    };
    const push = {
      addListener: vi.fn((event: string, callback: PluginCallback) =>
        addListener(pushListeners, event, callback),
      ),
      requestPermissions: vi.fn(async () => ({ receive: "granted" })),
      register: vi.fn(async () => {}),
    };
    Object.defineProperty(window, "Capacitor", {
      configurable: true,
      value: {
        isNativePlatform: () => true,
        Plugins: { App: app, PushNotifications: push },
      },
    });
    const fetchMock = vi.fn(async () => new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const view = render(
      <StrictMode>
        <NativeBridge />
      </StrictMode>,
    );
    await waitFor(() => {
      expect(appListeners.get("appStateChange")?.size).toBe(1);
      expect(appListeners.get("appUrlOpen")?.size).toBe(1);
      expect(pushListeners.get("registrationError")?.size).toBe(1);
      expect(pushListeners.get("pushNotificationActionPerformed")?.size).toBe(
        1,
      );
    });
    expect(push.requestPermissions).not.toHaveBeenCalled();
    for (const callback of appListeners.get("appUrlOpen") ?? []) {
      callback({ url: "https://bookuptempo.com/book/bridge" });
    }
    expect(routerPushMock).toHaveBeenCalledWith("/book/bridge");

    view.unmount();
    await waitFor(() => {
      expect([...appListeners.values()].every((listeners) => !listeners.size)).toBe(
        true,
      );
      expect([...pushListeners.values()].every((listeners) => !listeners.size)).toBe(
        true,
      );
    });
  });

  it("removes late native listeners and makes them inert on unmount", async () => {
    const pending: Array<{
      event: string;
      callback: PluginCallback;
      resolve: (listener: { remove: () => void }) => void;
    }> = [];
    const requestPermissions = vi.fn(async () => ({ receive: "granted" }));
    const register = vi.fn(async () => {});
    const addListener = vi.fn(
      (event: string, callback: PluginCallback) =>
        new Promise<{ remove: () => void }>((resolve) => {
          pending.push({ event, callback, resolve });
        }),
    );
    const app = {
      addListener,
      getLaunchUrl: vi.fn(async () => null),
    };
    const push = { addListener, requestPermissions, register };
    Object.defineProperty(window, "Capacitor", {
      configurable: true,
      value: {
        isNativePlatform: () => true,
        Plugins: { App: app, PushNotifications: push },
      },
    });

    const fetchMock = vi.fn(async () => new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<NativeBridge />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(document.documentElement.classList.contains("is-native")).toBe(true);
    expect(pending.length).toBe(4);

    view.unmount();
    expect(document.documentElement.classList.contains("is-native")).toBe(false);

    const removals: Array<ReturnType<typeof vi.fn>> = [];
    for (const registration of pending) {
      const remove = vi.fn();
      removals.push(remove);
      registration.resolve({ remove });
    }
    await waitFor(() =>
      expect(removals.every((remove) => remove.mock.calls.length === 1)).toBe(
        true,
      ),
    );

    for (const registration of pending) {
      registration.callback({
        value: "a".repeat(64),
        isActive: true,
        url: "https://www.bookuptempo.com/account",
      });
    }
    notifyNativeAuthSuccess();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });
});
