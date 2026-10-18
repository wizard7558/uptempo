// @vitest-environment happy-dom
//
// The project checkbox re-prices the visit on the server; these tests check the
// dialog asks for the right amounts and sends the same choice to checkout.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { VERTICALS } from "@/lib/verticals";
import { TermsProvider } from "@/lib/terms/client";
import messages from "@/i18n/messages/en.json";

const h = vi.hoisted(() => ({
  getCheckoutData: vi.fn(),
  completeAppointment: vi.fn(),
}));

vi.mock("@/actions/gift-cards", () => ({
  lookupGiftCardForCheckout: vi.fn(),
}));
vi.mock("@/actions/checkout", () => ({
  getCheckoutData: h.getCheckoutData,
  completeAppointment: h.completeAppointment,
  createCheckoutPaymentIntent: vi.fn(),
  sendReceipt: vi.fn(),
}));
vi.mock("@/lib/stripe/client", () => ({ stripePromise: null }));
vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PaymentElement: () => null,
  useStripe: () => null,
  useElements: () => null,
}));
vi.mock("@/components/checkout/rebook-prompt", () => ({ RebookPrompt: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CheckoutDialog } from "./checkout-dialog";

const APPT = "11111111-1111-4111-8111-111111111111";

/** What the server returns for a $400 session of a project with $200 deposit credit. */
function data(finalSession: boolean, isLastScheduled: boolean) {
  const applied = finalSession ? 20000 : 0;
  return {
    appointment: { id: APPT, status: "confirmed" },
    group: null,
    client: { id: "c1", name: "Casey", email: null, phone: null, stripeCustomerId: null, stripePaymentMethodId: null, hasCardOnFile: false },
    services: [{ serviceId: "s1", serviceName: "Sleeve session", priceCents: 40000 }],
    totalCents: 40000,
    storedValueBalanceCents: 0,
    storedValueAppliedCents: 0,
    cardChargeCents: 40000 - applied,
    depositAppliedCents: applied,
    project: { id: "p1", depositCreditCents: 20000, isLastScheduled },
    hasActiveMembership: false,
    memberDiscountPercent: 0,
    fullBbDiscountedTotalCents: 40000,
    eligibleForFullBb: false,
    staffName: "Riley",
  };
}

function renderDialog() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TermsProvider terms={VERTICALS.tattoo.terms}>
        <CheckoutDialog appointmentId={APPT} onClose={vi.fn()} onComplete={vi.fn()} />
      </TermsProvider>
    </NextIntlClientProvider>,
  );
}

const checkbox = () => screen.getByRole("checkbox", { name: /last .* for this project/i });

describe("CheckoutDialog project deposit credit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getCheckoutData.mockImplementation(async (_id: string, final?: boolean) => data(final === true, true));
    h.completeAppointment.mockResolvedValue({ success: true, totalCents: 20000 });
  });
  afterEach(cleanup);

  it("starts checked on the last scheduled session, with the credit applied", async () => {
    renderDialog();
    await waitFor(() => expect(checkbox().getAttribute("aria-checked")).toBe("true"));
    expect(h.getCheckoutData).toHaveBeenNthCalledWith(1, APPT);
    expect(h.getCheckoutData).toHaveBeenNthCalledWith(2, APPT, true);
    expect(screen.getByText(/Apply the \$200\.00 deposit credit/)).toBeTruthy();
    expect(screen.getByText("Deposit credit left: $0.00")).toBeTruthy();
    expect(screen.getByText("Deposit credit applied")).toBeTruthy();
    expect(screen.getByText("Card / cash due").nextSibling?.textContent).toBe("$200.00");
  });

  it("re-fetches the amounts when the box is unchecked and checked again", async () => {
    const user = userEvent.setup();
    renderDialog();
    await waitFor(() => expect(checkbox().getAttribute("aria-checked")).toBe("true"));

    await user.click(checkbox());
    await waitFor(() => expect(h.getCheckoutData).toHaveBeenLastCalledWith(APPT, false));
    await waitFor(() => expect(screen.getByText("Deposit credit left: $200.00")).toBeTruthy());
    expect(screen.queryByText("Deposit credit applied")).toBeNull();
    expect(screen.getByText("Card / cash due").nextSibling?.textContent).toBe("$400.00");

    await user.click(checkbox());
    await waitFor(() => expect(h.getCheckoutData).toHaveBeenLastCalledWith(APPT, true));
    await waitFor(() => expect(screen.getByText("Card / cash due").nextSibling?.textContent).toBe("$200.00"));
  });

  it("sends the checkbox choice to completeAppointment", async () => {
    const user = userEvent.setup();
    renderDialog();
    await waitFor(() => expect(checkbox().getAttribute("aria-checked")).toBe("true"));
    await user.click(screen.getByRole("button", { name: /cash/i }));
    await user.click(screen.getByRole("button", { name: "Complete Checkout" }));
    await waitFor(() => expect(h.completeAppointment).toHaveBeenCalledTimes(1));
    expect(h.completeAppointment.mock.calls[0][0]).toMatchObject({
      appointmentId: APPT,
      paymentMethod: "cash",
      finalProjectSession: true,
    });
  });

  it("starts unchecked, with no credit applied, when more sessions are booked", async () => {
    h.getCheckoutData.mockImplementation(async (_id: string, final?: boolean) => data(final === true, false));
    renderDialog();
    await waitFor(() => expect(screen.getByText("Deposit credit left: $200.00")).toBeTruthy());
    expect(checkbox().getAttribute("aria-checked")).toBe("false");
    expect(h.getCheckoutData).toHaveBeenCalledTimes(1);
  });

  it("shows no project box for an ordinary appointment", async () => {
    h.getCheckoutData.mockResolvedValue({ ...data(false, false), project: null });
    renderDialog();
    await waitFor(() => expect(screen.getByText("Services total")).toBeTruthy());
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
  describe("done screen card processing", () => {
    async function checkOutWith(result: Record<string, unknown>) {
      h.getCheckoutData.mockResolvedValue({ ...data(false, false), project: null });
      h.completeAppointment.mockResolvedValue({ success: true, ...result });
      const user = userEvent.setup();
      renderDialog();
      await waitFor(() => expect(screen.getByText("Services total")).toBeTruthy());
      await user.click(screen.getByRole("button", { name: /cash/i }));
      await user.click(screen.getByRole("button", { name: "Complete Checkout" }));
      await waitFor(() => expect(screen.getByText("Checkout Complete")).toBeTruthy());
    }

    it("shows the stored fee and what the business receives", async () => {
      await checkOutWith({
        totalCents: 6000,
        platformFeeCents: 300,
        processingRateLabel: "5%",
      });
      expect(screen.getByText("Card processing: 5% ($3.00)")).toBeTruthy();
      expect(screen.getByText("You receive: $57.00")).toBeTruthy();
    });

    it("shows nothing when the charge has no fee", async () => {
      await checkOutWith({
        totalCents: 6000,
        platformFeeCents: 0,
        processingRateLabel: null,
      });
      expect(screen.queryByText(/Card processing/)).toBeNull();
      expect(screen.queryByText(/You receive/)).toBeNull();
    });
  });
});
