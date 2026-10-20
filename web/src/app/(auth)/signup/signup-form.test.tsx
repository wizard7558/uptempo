// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  createBusinessAccount: vi.fn(),
  signInEmail: vi.fn(),
  routerPush: vi.fn(),
  identify: vi.fn(),
  track: vi.fn(),
  sequence: [] as string[],
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.routerPush }) }));
vi.mock("@/lib/auth/client", () => ({
  authClient: { signIn: { email: mocks.signInEmail } },
}));
vi.mock("@/actions/onboarding", () => ({
  createBusinessAccount: mocks.createBusinessAccount,
}));
vi.mock("@/lib/analytics/posthog-provider", () => ({
  identifyPostHogUser: mocks.identify,
  trackClientEvent: mocks.track,
}));
vi.mock("@/lib/terms/client", () => ({
  TermsProvider: ({ children }: { children: ReactNode }) => children,
  useT: () => (key: string) => key,
}));
vi.mock("@/components/onboarding/industry-picker", () => ({
  IndustryPicker: () => null,
}));

import { SignupForm } from "./signup-form";
import { NATIVE_AUTH_SUCCESS_EVENT } from "@/lib/native/push-register";

let authSuccess = vi.fn();

beforeEach(() => {
  Object.defineProperty(window, "Capacitor", {
    configurable: true,
    value: { isNativePlatform: () => true },
  });
  authSuccess = vi.fn(() => mocks.sequence.push("native-auth-success"));
  window.addEventListener(NATIVE_AUTH_SUCCESS_EVENT, authSuccess);
  mocks.sequence.length = 0;
  mocks.createBusinessAccount.mockReset().mockImplementation(async () => {
    mocks.sequence.push("create-business");
    return { success: true, slug: "demo-business" };
  });
  mocks.signInEmail.mockReset().mockImplementation(async () => {
    mocks.sequence.push("sign-in");
    return { error: null, data: { user: { id: "owner-1" } } };
  });
  mocks.routerPush.mockReset().mockImplementation(() => {
    mocks.sequence.push("navigate");
  });
  mocks.identify.mockReset().mockImplementation(() => {
    mocks.sequence.push("identify");
  });
  mocks.track.mockReset().mockImplementation(() => {
    mocks.sequence.push("track");
  });
});

afterEach(() => {
  cleanup();
  window.removeEventListener(NATIVE_AUTH_SUCCESS_EVENT, authSuccess);
  Reflect.deleteProperty(window, "Capacitor");
});

async function submitSignup() {
  const { container } = render(<SignupForm initialIndustry="general" />);
  for (const [id, value] of [
    ["ownerName", "Alex Owner"],
    ["email", "owner@example.com"],
    ["password", "secure-password"],
    ["businessName", "Demo Studio"],
  ]) {
    fireEvent.change(container.querySelector(`#${id}`)!, { target: { value } });
  }
  fireEvent.submit(container.querySelector("form")!);
  await waitFor(() => expect(mocks.signInEmail).toHaveBeenCalledTimes(1));
  return { container };
}

const signInFailures = [
  {
    failureMode: "returns an error",
    signIn: async () => ({ error: { message: "Sign-in failed" } }),
  },
  {
    failureMode: "rejects",
    signIn: async () => {
      throw new Error("Sign-in failed");
    },
  },
];

describe("SignupForm native auth notification", () => {
  it("keeps the general business signup flow and orders success work after sign-in", async () => {
    await submitSignup();

    await waitFor(() => expect(mocks.routerPush).toHaveBeenCalledWith("/onboarding"));
    expect(screen.getByText("industry.somethingElse")).toBeTruthy();
    expect(mocks.createBusinessAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerName: "Alex Owner",
        email: "owner@example.com",
        password: "secure-password",
        businessName: "Demo Studio",
        industry: "general",
      }),
    );
    expect(mocks.identify).toHaveBeenCalledWith("owner@example.com", {
      email: "owner@example.com",
      name: "Alex Owner",
      tenantSlug: "demo-business",
      role: "owner",
    });
    expect(mocks.track).toHaveBeenCalledWith("salon.signup_completed", {
      slug: "demo-business",
    });
    expect(mocks.sequence).toEqual([
      "create-business",
      "sign-in",
      "native-auth-success",
      "identify",
      "track",
      "navigate",
    ]);
  });

  it.each(signInFailures)(
    "offers account recovery when automatic sign-in $failureMode",
    async ({ signIn }) => {
      mocks.signInEmail.mockImplementation(async () => {
        mocks.sequence.push("sign-in");
        return signIn();
      });

      const { container } = await submitSignup();

      expect(
        screen.getByText(
          "Your business account was created, but automatic sign-in failed. Sign in with your new account to continue.",
        ),
      ).toBeTruthy();
      const recoveryLink = screen.getByRole("link", { name: "Sign in" });
      expect(recoveryLink.getAttribute("href")).toBe(
        "/login?callbackUrl=%2Fonboarding",
      );
      expect(container.querySelector("form")).toBeNull();
      expect(mocks.createBusinessAccount).toHaveBeenCalledTimes(1);
      expect(authSuccess).not.toHaveBeenCalled();
      expect(mocks.identify).not.toHaveBeenCalled();
      expect(mocks.track).not.toHaveBeenCalled();
      expect(mocks.routerPush).not.toHaveBeenCalled();
      expect(mocks.sequence).toEqual(["create-business", "sign-in"]);
    },
  );
});
