// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { updateClientName, identifyPostHogUser, notifyNativeAuthSuccess, toastError } = vi.hoisted(() => ({
  updateClientName: vi.fn(),
  identifyPostHogUser: vi.fn(),
  notifyNativeAuthSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/actions/booking-public", () => ({ updateClientName }));
vi.mock("@/lib/terms/client", () => ({ useT: () => (key: string) => key }));
vi.mock("@/lib/analytics/posthog-provider", () => ({ identifyPostHogUser }));
vi.mock("@/lib/native/push-register", () => ({ notifyNativeAuthSuccess }));
vi.mock("sonner", () => ({ toast: { error: toastError } }));

import { DetailsStep, IdentityStep } from "./details-step";

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response;
}

function renderDetailsStep(
  props: Partial<React.ComponentProps<typeof DetailsStep>> = {},
) {
  return render(
    <DetailsStep
      businessId="business-1"
      clientId={null}
      clientName={null}
      onComplete={vi.fn()}
      onContinue={vi.fn()}
      onNotYou={vi.fn()}
      {...props}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  updateClientName.mockReset();
  identifyPostHogUser.mockReset();
  notifyNativeAuthSuccess.mockReset();
  toastError.mockReset();
});

describe("DetailsStep verification channel", () => {
  it("keeps phone verification as the default and cannot advance after an invalid code", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ error: "Invalid code" }, 400));
    vi.stubGlobal("fetch", fetchMock);
    renderDetailsStep({ onComplete });

    await user.type(screen.getByLabelText("detailsStep.name"), "Ana");
    await user.type(screen.getByLabelText("detailsStep.phone"), "+15555550100");
    await user.click(screen.getByRole("button", { name: "detailsStep.sendCode" }));

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      identifier: "+15555550100",
      phone: "+15555550100",
      businessId: "business-1",
    });
    expect(screen.getByLabelText("detailsStep.code")).toBeTruthy();

    await user.type(screen.getByLabelText("detailsStep.code"), "123456");
    await user.click(screen.getByRole("button", { name: "detailsStep.verify" }));

    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({
      identifier: "+15555550100",
      code: "123456",
      phone: "+15555550100",
      name: "Ana",
      businessId: "business-1",
    });
    expect(await screen.findByText("Invalid code")).toBeTruthy();
    expect(screen.getByLabelText("detailsStep.code")).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();
    expect(notifyNativeAuthSuccess).not.toHaveBeenCalled();
  });

  it("uses email OTP and name completion for a new client without offering SMS", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ isReturning: false, clientId: "client-1" }));
    vi.stubGlobal("fetch", fetchMock);
    updateClientName.mockResolvedValue({ success: true });
    renderDetailsStep({ verificationChannel: "email", onComplete });

    expect(screen.getByLabelText("Email address")).toBeTruthy();
    expect(screen.queryByLabelText(/Mobile number/i)).toBeNull();
    expect(screen.queryByText(/text your code and appointment reminders/i)).toBeNull();
    await user.type(screen.getByLabelText("Email address"), "ana@example.com");
    await user.click(screen.getByRole("button", { name: "Send Code" }));

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      identifier: "ana@example.com",
      businessId: "business-1",
    });
    await user.type(screen.getByLabelText("Verification code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({
      identifier: "ana@example.com",
      code: "123456",
      businessId: "business-1",
    });
    expect(notifyNativeAuthSuccess).toHaveBeenCalledTimes(1);
    expect(screen.getByText("What is your first name?")).toBeTruthy();

    await user.type(screen.getByLabelText("What is your first name?"), "Ana");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(updateClientName).toHaveBeenCalledWith("client-1", "Ana");
    expect(onComplete).toHaveBeenCalledWith("client-1", "Ana", undefined);
  });

  it("does not complete after an email OTP failure", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ error: "Invalid code" }, 400));
    vi.stubGlobal("fetch", fetchMock);
    renderDetailsStep({ verificationChannel: "email", onComplete });

    await user.type(screen.getByLabelText("Email address"), "ana@example.com");
    await user.click(screen.getByRole("button", { name: "Send Code" }));
    await user.type(screen.getByLabelText("Verification code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({
      identifier: "ana@example.com",
      code: "123456",
      businessId: "business-1",
    });
    expect(await screen.findByText("Invalid code")).toBeTruthy();
    expect(screen.getByLabelText("Verification code")).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();
    expect(notifyNativeAuthSuccess).not.toHaveBeenCalled();
  });

  it("verifies returning email clients directly and prioritizes an existing session", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ isReturning: true, clientId: "client-2", name: "Bea" }));
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = renderDetailsStep({ verificationChannel: "email", onComplete });

    await user.type(screen.getByLabelText("Email address"), "bea@example.com");
    await user.click(screen.getByRole("button", { name: "Send Code" }));
    await user.type(screen.getByLabelText("Verification code"), "654321");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({
      identifier: "bea@example.com",
      code: "654321",
      businessId: "business-1",
    });
    expect(onComplete).toHaveBeenCalledWith("client-2", "Bea", undefined);
    expect(notifyNativeAuthSuccess).toHaveBeenCalledTimes(1);

    rerender(
      <DetailsStep
        businessId="business-1"
        clientId="client-3"
        clientName="Casey"
        verificationChannel="email"
        onComplete={onComplete}
        onContinue={vi.fn()}
        onNotYou={vi.fn()}
      />,
    );
    expect(screen.getByText("Casey")).toBeTruthy();
    expect(screen.queryByLabelText("Email address")).toBeNull();
    expect(screen.getByRole("button", { name: "detailsStep.continue" })).toBeTruthy();
  });

  it("keeps IdentityStep optional-phone behavior for its other callsites", () => {
    render(
      <IdentityStep businessId="business-1" onComplete={vi.fn()} />,
    );

    expect(screen.getByLabelText("Mobile number (optional)")).toBeTruthy();
    expect(screen.getByText("We'll text your code and appointment reminders here.")).toBeTruthy();
  });
});
