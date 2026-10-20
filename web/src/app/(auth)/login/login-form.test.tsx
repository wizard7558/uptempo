// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  signInEmail: vi.fn(),
  routerPush: vi.fn(),
  identify: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.routerPush }) }));
vi.mock("@/lib/auth/client", () => ({
  authClient: { signIn: { email: mocks.signInEmail } },
}));
vi.mock("@/lib/analytics/posthog-provider", () => ({
  identifyPostHogUser: mocks.identify,
}));

import { LoginForm } from "./login-form";
import { NATIVE_AUTH_SUCCESS_EVENT } from "@/lib/native/push-register";

let authSuccess = vi.fn();

beforeEach(() => {
  Object.defineProperty(window, "Capacitor", {
    configurable: true,
    value: { isNativePlatform: () => true },
  });
  authSuccess = vi.fn();
  window.addEventListener(NATIVE_AUTH_SUCCESS_EVENT, authSuccess);
  mocks.signInEmail.mockReset();
  mocks.routerPush.mockReset();
  mocks.identify.mockReset();
});

afterEach(() => {
  cleanup();
  window.removeEventListener(NATIVE_AUTH_SUCCESS_EVENT, authSuccess);
  Reflect.deleteProperty(window, "Capacitor");
});

describe("LoginForm native auth notification", () => {
  it("notifies the native bridge only after sign-in succeeds", async () => {
    mocks.signInEmail.mockResolvedValue({
      error: null,
      data: { user: { id: "owner-1" } },
    });
    const { container } = render(<LoginForm />);
    fireEvent.change(container.querySelector("#email")!, {
      target: { value: "owner@example.com" },
    });
    fireEvent.change(container.querySelector("#password")!, {
      target: { value: "secret" },
    });

    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => expect(authSuccess).toHaveBeenCalledTimes(1));
    expect(mocks.routerPush).toHaveBeenCalledWith("/onboarding");
  });

  it("does not notify or navigate after a rejected sign-in response", async () => {
    mocks.signInEmail.mockResolvedValue({ error: { message: "Invalid credentials" } });
    const { container } = render(<LoginForm />);
    fireEvent.change(container.querySelector("#email")!, {
      target: { value: "owner@example.com" },
    });
    fireEvent.change(container.querySelector("#password")!, {
      target: { value: "wrong" },
    });

    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => expect(screen.getByText("Invalid email or password")).toBeTruthy());
    expect(authSuccess).not.toHaveBeenCalled();
    expect(mocks.routerPush).not.toHaveBeenCalled();
  });
});
