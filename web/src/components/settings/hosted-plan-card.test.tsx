// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { getVertical } from "@/lib/verticals";
import { openBillingPortal, type HostedPlan } from "@/actions/hosted-billing";

vi.mock("@/actions/hosted-billing", () => ({
  openBillingPortal: vi.fn(),
}));

import { HostedPlanCard } from "./hosted-plan-card";

beforeEach(() => {
  vi.mocked(openBillingPortal)
    .mockReset()
    .mockResolvedValue({ error: "Billing portal unavailable in this test." });
  Reflect.deleteProperty(window, "Capacitor");
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "Capacitor");
});

const terms = getVertical("hair_salon").terms;

const base: HostedPlan = {
  comped: false,
  billableStaff: 3,
  smsLineStatus: "off",
  monthlyCents: 2400,
  trialEndsAt: null,
  subscriptionStatus: "active",
  processingLabel: "5%",
  hasBillingAccount: true,
};

describe("HostedPlanCard", () => {
  it("renders nothing without a plan", () => {
    const { container } = render(<HostedPlanCard plan={null} terms={terms} />);
    expect(container.textContent).toBe("");
  });

  it("renders the read-only notice during SSR and does not expose a billing CTA", () => {
    const markup = renderToStaticMarkup(
      <HostedPlanCard plan={base} terms={terms} />,
    );
    expect(markup).toContain(
      "Plan changes and platform payment method management are handled on the Uptempo website.",
    );
    expect(markup).not.toMatch(/Manage billing/);
    expect(openBillingPortal).not.toHaveBeenCalled();
  });

  it("shows the read-only notice in a native app without calling the portal", async () => {
    Object.defineProperty(window, "Capacitor", {
      configurable: true,
      value: { isNativePlatform: () => true },
    });

    render(<HostedPlanCard plan={base} terms={terms} />);

    expect(
      await screen.findByText(
        "Plan changes and platform payment method management are handled on the Uptempo website.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Manage billing" }),
    ).toBeNull();
    expect(openBillingPortal).not.toHaveBeenCalled();
  });

  it("says Uptempo is free for a comped business, with no Manage billing", () => {
    render(<HostedPlanCard plan={{ ...base, comped: true }} terms={terms} />);
    expect(screen.getByText("Uptempo is free for your business.")).toBeTruthy();
    expect(screen.getByText("Card processing: no charge")).toBeTruthy();
    expect(screen.queryByText("Manage billing")).toBeNull();
  });

  it("shows current pricing on web and opens the billing portal from its CTA", async () => {
    render(<HostedPlanCard plan={base} terms={terms} />);
    expect(screen.getByText(/3 .* · \$24\.00\/month/)).toBeTruthy();
    expect(screen.getByText("Text reminders: Not set up")).toBeTruthy();
    expect(screen.getByText("Card processing: 5% of card payments")).toBeTruthy();

    const button = await screen.findByRole("button", { name: "Manage billing" });
    fireEvent.click(button);
    await waitFor(() => expect(openBillingPortal).toHaveBeenCalledTimes(1));
  });

  it("shows the free-until date during a trial", () => {
    render(
      <HostedPlanCard
        plan={{ ...base, trialEndsAt: "2030-03-15T12:00:00.000Z" }}
        terms={terms}
        timezone="UTC"
      />,
    );
    expect(screen.getByText("Free until Mar 15, 2030")).toBeTruthy();
  });

  it("hides Manage billing without a billing account", () => {
    render(
      <HostedPlanCard plan={{ ...base, hasBillingAccount: false }} terms={terms} />,
    );
    expect(screen.queryByText("Manage billing")).toBeNull();
  });
});
