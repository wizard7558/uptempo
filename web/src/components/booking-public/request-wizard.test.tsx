// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { VERTICALS } from "@/lib/verticals";
import { TermsProvider } from "@/lib/terms/client";
import { resolveRequestFields } from "@/lib/requests/fields";
import messages from "@/i18n/messages/en.json";

const { submitBookingRequest, chargeBookingDeposit } = vi.hoisted(() => ({
  submitBookingRequest: vi.fn(),
  chargeBookingDeposit: vi.fn(),
}));

vi.mock("@/actions/requests-public", () => ({
  uploadRequestPhoto: vi.fn(),
  removeRequestPhoto: vi.fn(),
  submitBookingRequest,
}));
vi.mock("@/actions/deposits", () => ({
  previewBookingDeposit: vi.fn(),
  chargeBookingDeposit,
}));
vi.mock("@/actions/booking-public", () => ({ updateClientName: vi.fn() }));
vi.mock("@/actions/on-site", () => ({ checkPostalCodePublic: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { RequestWizard, type RequestWizardProps } from "./request-wizard";

const SEND = "Send request. The deposit comes with the quote.";

function renderWizard(props: Partial<RequestWizardProps> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TermsProvider terms={VERTICALS.tattoo.terms}>
        <RequestWizard
          salonId="s1"
          salonName="Ink"
          hasSalonLogo={false}
          clientSession={{ clientId: "c1", clientName: "Casey" }}
          fields={resolveRequestFields(VERTICALS.tattoo.requestFields)}
          services={[{ id: "svc-1", name: "Half-day session" }]}
          staff={[{ id: "st-1", displayName: "Riley Artist" }]}
          {...props}
        />
      </TermsProvider>
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  submitBookingRequest.mockReset();
  chargeBookingDeposit.mockReset();
});

describe("RequestWizard", () => {
  it("names the four steps and starts on the service", () => {
    renderWizard();
    const progress = screen.getByRole("navigation", { name: "Booking progress" });
    expect(progress.textContent).toContain("Step 1 of 4");
    expect(progress.textContent).toContain("Piece");
    expect(progress.textContent).toContain("Describe what you need");
    expect(progress.textContent).toContain("Your details");
    expect(progress.textContent).toContain("Send request");
    expect(screen.getByRole("heading", { name: "Choose a piece" })).toBeTruthy();
    expect(screen.queryByText("Where on your body?")).toBeNull();
    expect(screen.queryByRole("button", { name: SEND })).toBeNull();
  });

  it("shows the Books closed panel with the next opening date instead of the form", () => {
    renderWizard({ booksClosed: true, booksClosedDate: "March 1, 2027" });
    expect(screen.getByRole("heading", { name: "Books are closed" })).toBeTruthy();
    expect(screen.getByText("We open for new requests on March 1, 2027.")).toBeTruthy();
    expect(screen.queryByText("Describe what you need")).toBeNull();
  });

  it("says to check back soon when no opening is scheduled", () => {
    renderWizard({ booksClosed: true, booksClosedDate: null });
    expect(
      screen.getByText("We're not taking new requests right now. Check back soon."),
    ).toBeTruthy();
  });

  it("sends the request from step 4 and does not charge a deposit", async () => {
    submitBookingRequest.mockResolvedValue({ success: true, id: "req-1" });
    const user = userEvent.setup();
    renderWizard();

    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Step 2 of 4")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Describe what you need" })).toBeTruthy();
    expect(screen.getByText("When works for you?")).toBeTruthy();

    await user.type(screen.getByLabelText("Where on your body?"), "Left forearm");
    await user.selectOptions(screen.getByLabelText("About how big?"), "medium");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByText("Step 3 of 4")).toBeTruthy();
    expect(screen.getByText("Casey")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Not you?" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByText("Step 4 of 4")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Send request" })).toBeTruthy();
    expect(
      screen.getByText(
        "We will review this at the studio and send the client a price for the session. The deposit comes later, with the quote.",
      ),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: SEND }));

    expect(submitBookingRequest).toHaveBeenCalledWith({
      serviceId: null,
      staffId: null,
      answers: { placement: "Left forearm", size: "medium" },
      preferredWindows: [],
      attachmentIds: [],
    });
    expect(chargeBookingDeposit).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Request sent" })).toBeTruthy();
  });
});
