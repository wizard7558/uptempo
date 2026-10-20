// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  acceptInvitation: vi.fn(),
  joinBusinessFromInvitation: vi.fn(),
  signInEmail: vi.fn(),
  routerPush: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.routerPush }) }));
vi.mock("@/lib/auth/client", () => ({
  authClient: { signIn: { email: mocks.signInEmail } },
}));
vi.mock("@/actions/team", () => ({
  acceptInvitation: mocks.acceptInvitation,
  joinBusinessFromInvitation: mocks.joinBusinessFromInvitation,
}));
vi.mock("@/lib/terms/client", () => ({ useT: () => (key: string) => key }));

import { AcceptInviteForm } from "./accept-form";
import { NATIVE_AUTH_SUCCESS_EVENT } from "@/lib/native/push-register";

let authSuccess = vi.fn();

beforeEach(() => {
  Object.defineProperty(window, "Capacitor", {
    configurable: true,
    value: { isNativePlatform: () => true },
  });
  authSuccess = vi.fn();
  window.addEventListener(NATIVE_AUTH_SUCCESS_EVENT, authSuccess);
  mocks.acceptInvitation.mockReset().mockResolvedValue({
    success: true,
    tenantSlug: "demo-business",
  });
  mocks.joinBusinessFromInvitation.mockReset();
  mocks.signInEmail.mockReset();
  mocks.routerPush.mockReset();
});

afterEach(() => {
  cleanup();
  window.removeEventListener(NATIVE_AUTH_SUCCESS_EVENT, authSuccess);
  Reflect.deleteProperty(window, "Capacitor");
});

function renderAndSubmitInvite(role = "staff") {
  const rendered = render(
    <AcceptInviteForm
      token="invite-token"
      email="new-owner@example.com"
      businessName="Demo Studio"
      role={role}
    />,
  );
  const { container } = rendered;
  fireEvent.change(container.querySelector("#accept-name")!, {
    target: { value: "Alex Owner" },
  });
  fireEvent.change(container.querySelector("#accept-password")!, {
    target: { value: "secure-password" },
  });
  fireEvent.change(container.querySelector("#accept-confirm-password")!, {
    target: { value: "secure-password" },
  });
  fireEvent.submit(container.querySelector("form")!);
  return rendered;
}

async function submitInvite(role?: string) {
  const rendered = renderAndSubmitInvite(role);
  await waitFor(() => expect(mocks.signInEmail).toHaveBeenCalledTimes(1));
  return rendered;
}

const inviteSignInFailures = [
  {
    role: "provider",
    failureMode: "returns an error",
    setup: () =>
      mocks.signInEmail.mockResolvedValue({ error: { message: "Sign-in failed" } }),
  },
  {
    role: "admin",
    failureMode: "rejects",
    setup: () => mocks.signInEmail.mockRejectedValue(new Error("Sign-in failed")),
  },
];

describe("AcceptInviteForm native auth notification", () => {
  it("notifies after invitation acceptance and session creation both succeed", async () => {
    mocks.signInEmail.mockResolvedValue({
      error: null,
      data: { user: { id: "owner-1" } },
    });

    await submitInvite();

    await waitFor(() => expect(mocks.routerPush).toHaveBeenCalledWith("/schedule"));
    expect(mocks.acceptInvitation).toHaveBeenCalledTimes(1);
    expect(mocks.signInEmail).toHaveBeenCalledWith({
      email: "new-owner@example.com",
      password: "secure-password",
      callbackURL: "/schedule",
    });
    expect(authSuccess).toHaveBeenCalledTimes(1);
  });

  it.each(inviteSignInFailures)(
    "recovers after invitation acceptance when sign-in $failureMode for a $role",
    async ({ role, setup }) => {
      setup();
      const { container } = await submitInvite(role);

      expect(
        screen.getByText(
          "Your invitation was accepted, but automatic sign-in failed. Sign in with the invited email and password to continue.",
        ),
      ).toBeTruthy();
      const recoveryLink = screen.getByRole("link", { name: "Sign in" });
      expect(recoveryLink.getAttribute("href")).toBe(
        "/login?callbackUrl=%2Fschedule",
      );
      expect(recoveryLink.getAttribute("href")).not.toContain("invite-token");
      expect(container.querySelector("form")).toBeNull();
      expect(mocks.acceptInvitation).toHaveBeenCalledTimes(1);
      expect(mocks.signInEmail).toHaveBeenCalledWith({
        email: "new-owner@example.com",
        password: "secure-password",
        callbackURL: "/schedule",
      });
      expect(authSuccess).not.toHaveBeenCalled();
      expect(mocks.routerPush).not.toHaveBeenCalled();
    },
  );

  it("keeps the pending invitation callback on the pre-acceptance sign-in link", () => {
    render(
      <AcceptInviteForm
        token="invite-token"
        email="new-owner@example.com"
        businessName="Demo Studio"
        role="provider"
      />,
    );

    expect(
      screen.getByRole("link", { name: "Sign in to join" }).getAttribute("href"),
    ).toBe("/login?callbackUrl=%2Finvite%2Finvite-token");
  });

  it("keeps invitation acceptance failures retryable", async () => {
    mocks.acceptInvitation.mockResolvedValue({
      success: false,
      error: "Invitation expired",
    });
    const { container } = renderAndSubmitInvite("provider");
    await waitFor(() => expect(screen.getByText("Invitation expired")).toBeTruthy());

    expect(container.querySelector("form")).not.toBeNull();
    expect(mocks.acceptInvitation).toHaveBeenCalledTimes(1);
    expect(mocks.signInEmail).not.toHaveBeenCalled();
  });
});
