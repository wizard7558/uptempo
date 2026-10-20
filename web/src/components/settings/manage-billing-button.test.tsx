// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  openBillingPortal: vi.fn(),
  isNativeApp: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/actions/hosted-billing", () => ({
  openBillingPortal: mocks.openBillingPortal,
}));
vi.mock("@/lib/native/client", () => ({ isNativeApp: mocks.isNativeApp }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

import { ManageBillingButton } from "./manage-billing-button";

const props = {
  label: "Manage billing",
  nativeNotice: "Billing changes are managed on the web.",
};

beforeEach(() => {
  mocks.openBillingPortal.mockReset();
  mocks.isNativeApp.mockReset();
  mocks.toastError.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("ManageBillingButton runtime boundary", () => {
  it("renders nothing during server rendering while runtime is unknown", () => {
    const html = renderToString(<ManageBillingButton {...props} />);

    expect(html).toBe("");
  });

  it("shows the web-managed notice in a native shell without opening the portal", async () => {
    mocks.isNativeApp.mockReturnValue(true);

    render(<ManageBillingButton {...props} />);

    expect(await screen.findByText(props.nativeNotice)).toBeTruthy();
    expect(screen.queryByRole("button", { name: props.label })).toBeNull();
    expect(mocks.openBillingPortal).not.toHaveBeenCalled();
  });

  it("keeps portal access on the web and surfaces portal errors", async () => {
    mocks.isNativeApp.mockReturnValue(false);
    mocks.openBillingPortal.mockResolvedValue({ error: "Portal unavailable" });

    render(<ManageBillingButton {...props} />);

    const button = await screen.findByRole("button", { name: props.label });
    fireEvent.click(button);

    await waitFor(() => expect(mocks.openBillingPortal).toHaveBeenCalledTimes(1));
    expect(mocks.toastError).toHaveBeenCalledWith("Portal unavailable");
  });

  it("checks native status again when the billing action is clicked", async () => {
    mocks.isNativeApp.mockReturnValueOnce(false).mockReturnValue(true);

    render(<ManageBillingButton {...props} />);

    const button = await screen.findByRole("button", { name: props.label });
    fireEvent.click(button);

    expect(mocks.isNativeApp).toHaveBeenCalledTimes(2);
    expect(mocks.openBillingPortal).not.toHaveBeenCalled();
  });
});
