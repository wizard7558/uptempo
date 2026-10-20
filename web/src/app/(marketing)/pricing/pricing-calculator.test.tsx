// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/i18n/messages/en.json";
import { PricingCalculator } from "./pricing-calculator";

afterEach(cleanup);

function renderCalculator() {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <PricingCalculator />
    </NextIntlClientProvider>,
  );
  return userEvent.setup();
}

async function setStaff(user: ReturnType<typeof userEvent.setup>, count: number) {
  for (let staff = 1; staff < count; staff += 1) {
    await user.click(screen.getByRole("button", { name: "One more person" }));
  }
}

describe("PricingCalculator", () => {
  it("shows $12 for one person without texts", () => {
    renderCalculator();
    expect(screen.getByTestId("pricing-total").textContent).toBe("$12");
    expect(screen.queryByLabelText("Texts per month")).toBeNull();
  });

  it("shows $33 for three people with the text line and 100 texts", async () => {
    const user = renderCalculator();
    await setStaff(user, 3);
    await user.click(screen.getByRole("switch", { name: "Text reminders" }));
    const texts = screen.getByLabelText("Texts per month");
    await user.clear(texts);
    await user.type(texts, "100");
    expect(screen.getByTestId("pricing-total").textContent).toBe("$33");
  });

  it("caps the staff price at $42", async () => {
    const user = renderCalculator();
    await setStaff(user, 9);
    expect(screen.getByTestId("pricing-total").textContent).toBe("$42");
  });

  it("stops at ten people", async () => {
    const user = renderCalculator();
    await setStaff(user, 10);
    expect(screen.getByRole("button", { name: "One more person" })).toHaveProperty("disabled", true);
  });

  it("shows card processing as one 5% rate with the worked example", () => {
    renderCalculator();
    expect(screen.getByText("Card processing: 5% of card payments")).toBeTruthy();
    expect(screen.getByText("On $3,000 of card payments: $150")).toBeTruthy();
  });
});
