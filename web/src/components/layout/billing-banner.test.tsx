// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BillingBanner } from "./billing-banner";

afterEach(cleanup);

describe("BillingBanner", () => {
  it.each([
    ["past_due", "Your last Uptempo payment didn't go through."],
    ["unpaid", "Your last Uptempo payment didn't go through."],
    ["paused", "Your Uptempo plan is paused because no card was added."],
    ["canceled", "Your Uptempo plan is canceled."],
  ])("renders for %s", (status, text) => {
    render(<BillingBanner status={status} />);
    expect(screen.getByText(text, { exact: false })).toBeTruthy();
    const link = screen.getByText("Manage billing");
    expect(link.getAttribute("href")).toBe("/settings/billing");
  });

  it.each(["active", "trialing", null, "constructor"])(
    "renders nothing for %s",
    (status) => {
      const { container } = render(<BillingBanner status={status} />);
      expect(container.textContent).toBe("");
    },
  );
});
