// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BillingSwitchNotice } from "./billing-switch-notice";

afterEach(cleanup);

describe("BillingSwitchNotice", () => {
  it("shows the future switch date and details link only after the notice was sent", () => {
    render(
      <BillingSwitchNotice
        noticeSentAt={new Date("2026-10-01T10:00:00.000Z")}
        switchAt={new Date("2026-12-01T14:00:00.000Z")}
      />,
    );
    expect(screen.getByText("Your plan changes on December 1, 2026.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "See pricing details" }).getAttribute("href")).toBe("/pricing");
  });

  it("does not show a notice when it was never sent or its switch date passed", () => {
    const { container, rerender } = render(
      <BillingSwitchNotice
        noticeSentAt={null}
        switchAt={new Date("2027-12-01T14:00:00.000Z")}
      />,
    );
    expect(container.textContent).toBe("");
    rerender(
      <BillingSwitchNotice
        noticeSentAt={new Date("2026-01-01T00:00:00.000Z")}
        switchAt={new Date("2026-01-02T14:00:00.000Z")}
      />,
    );
    expect(container.textContent).toBe("");
  });
});
