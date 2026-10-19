// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { TextLineSnapshot } from "@/actions/text-line";

const h = vi.hoisted(() => ({
  routerRefresh: vi.fn(),
  getTextLine: vi.fn(),
  submitTextLine: vi.fn(),
  resendTextLineConfirmation: vi.fn(),
  turnOffTextLine: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: h.routerRefresh }),
}));
vi.mock("@/lib/terms/client", () => ({
  useT: () => (key: string, values?: Record<string, string>) => {
    const messages: Record<string, string> = {
      "textLine.title": "Business text line",
      "textLine.unavailable":
        "Text reminders aren't available yet. Please contact Uptempo support.",
      "textLine.offCopy":
        "Text reminders cost $4 a month plus 5 cents a text, with a one-time $19 setup. Carriers approve your business first.",
      "textLine.offApproved": `Text reminders are off. Your approved number is ${values?.phoneNumber}. Turn it back on without registering again.`,
      "textLine.sharedCopy":
        "Texts send from Uptempo's shared number. Set up your own number for free.",
      "textLine.pendingCopy":
        "Waiting for carrier approval. Email reminders keep working.",
      "textLine.actionNeededCopy":
        "Your business registration needs an update. Review the details and try again.",
      "textLine.confirmTextCopy": `Twilio sent a text to ${values?.mobile}. Reply YES within 24 hours to confirm.`,
      "textLine.activeCopy": `Text reminders are on. Your number is ${values?.phoneNumber}.`,
      "textLine.setUp": "Set up text reminders",
      "textLine.setUpFree": "Set up your own number for free",
      "textLine.fixAndResubmit": "Fix and resubmit",
      "textLine.sendAgain": "Send it again",
      "textLine.turnOff": "Turn off text reminders",
      "textLine.turnOn": "Turn text reminders back on",
      "textLine.submit": "Submit for carrier approval",
      "textLine.cancel": "Cancel",
      "textLine.fields.legalName": "Legal business name",
      "textLine.fields.businessType": "Business type",
      "textLine.fields.einOptional": "EIN (optional)",
      "textLine.fields.einRequired": "EIN (required to resubmit)",
      "textLine.fields.einHint":
        "Your full EIN is sent securely for registration and isn't saved. Without an EIN, choose Sole proprietor.",
      "textLine.fields.street": "Business street address",
      "textLine.fields.street2": "Address line 2 (optional)",
      "textLine.fields.city": "City",
      "textLine.fields.state": "State",
      "textLine.fields.postalCode": "ZIP code",
      "textLine.fields.website": "Business website (optional)",
      "textLine.fields.firstName": "Owner first name",
      "textLine.fields.lastName": "Owner last name",
      "textLine.fields.title": "Owner title",
      "textLine.fields.email": "Owner email",
      "textLine.fields.mobile": "Owner mobile number",
      "textLine.fields.feeAgreement":
        "I understand the setup and monthly text line costs shown above.",
      "textLine.feeDisclosure":
        "A one-time $19 setup fee will be added to your next invoice. Once approved, the line costs $4 a month plus $0.05 per text.",
      "textLine.sharedFee":
        "Your own number setup is free because your business already uses the shared number. Once approved, the line costs $4 a month plus $0.05 per text.",
      "textLine.compedFee":
        "No one-time setup fee will be added. Your business's comped plan remains free.",
      "textLine.privacy": "Read our privacy policy",
      "textLine.errors.billing_sync_retryable":
        "Your text line status changed, but billing could not be updated yet. Try again shortly.",
      "textLine.saved": "Your information was submitted for carrier approval.",
      "textLine.confirmationResent": "The confirmation text was sent again.",
      "textLine.turnedOff": "Text reminders are off.",
    };
    return messages[key] ?? key;
  },
}));
vi.mock("@/actions/text-line", () => ({
  getTextLine: (...args: unknown[]) => h.getTextLine(...args),
  submitTextLine: (...args: unknown[]) => h.submitTextLine(...args),
  resendTextLineConfirmation: (...args: unknown[]) =>
    h.resendTextLineConfirmation(...args),
  turnOffTextLine: (...args: unknown[]) => h.turnOffTextLine(...args),
}));

import { TextLineCard } from "./text-line-card";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  h.getTextLine.mockResolvedValue(null);
  h.submitTextLine.mockResolvedValue({ ok: true, status: "pending" });
  h.resendTextLineConfirmation.mockResolvedValue({
    ok: true,
    status: "action_needed",
  });
  h.turnOffTextLine.mockResolvedValue({ ok: true, status: "off" });
});

function snapshot(overrides: Partial<TextLineSnapshot> = {}): TextLineSnapshot {
  return {
    status: "off",
    available: true,
    phoneNumber: null,
    mobile: null,
    reason: null,
    reasonMessage: null,
    formDefaults: null,
    setupFeeExempt: false,
    setupFeeExemptionReason: null,
    setupFeeAdded: false,
    canReactivate: false,
    requiresEin: false,
    ...overrides,
  };
}

describe("TextLineCard", () => {
  it("shows a clear unavailable state with no dead form", () => {
    render(<TextLineCard initialState={snapshot({ available: false })} />);
    expect(
      screen.getByText(
        "Text reminders aren't available yet. Please contact Uptempo support.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Set up text reminders" }),
    ).toBeNull();
    expect(screen.queryByLabelText("Legal business name")).toBeNull();
  });

  it("discloses the fee before submission and requires acknowledgment", () => {
    render(<TextLineCard initialState={snapshot()} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Set up text reminders" }),
    );
    expect(
      screen.getByText(
        /one-time \$19 setup fee will be added to your next invoice/,
      ),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Submit for carrier approval",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(
      (
        screen.getByRole("button", {
          name: "Submit for carrier approval",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(
      screen
        .getByRole("link", { name: "Read our privacy policy" })
        .getAttribute("href"),
    ).toBe("/privacy");
  });

  it("shows the exact shared-number exemption before setup", () => {
    render(
      <TextLineCard
        initialState={snapshot({
          status: "shared",
          setupFeeExempt: true,
          setupFeeExemptionReason: "shared",
        })}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Set up your own number for free" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Set up your own number for free" }),
    );
    expect(
      screen.getByText(
        /setup is free because your business already uses the shared number/,
      ),
    ).toBeTruthy();
  });

  it("does not prefill the EIN for a required resubmission", () => {
    render(
      <TextLineCard
        initialState={snapshot({
          status: "action_needed",
          requiresEin: true,
          reason: "business_rejected",
          reasonMessage: "The legal name did not match the business record.",
          formDefaults: {
            legalBusinessName: "Northwind Services LLC",
            businessType: "LLC",
            businessAddress: {
              street: "123 Main Street",
              city: "Seattle",
              state: "WA",
              postalCode: "98101",
            },
            owner: {
              firstName: "Riley",
              lastName: "Owner",
              title: "Owner",
              email: "owner@example.com",
              mobile: "+12065550123",
            },
          },
        })}
      />,
    );
    expect(
      screen.getByText("The legal name did not match the business record."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fix and resubmit" }));
    const ein = screen.getByLabelText(
      "EIN (required to resubmit)",
    ) as HTMLInputElement;
    expect(ein.value).toBe("");
    expect(ein.required).toBe(true);
    expect(
      (screen.getByLabelText("Legal business name") as HTMLInputElement).value,
    ).toBe("Northwind Services LLC");
  });

  it("shows the sole-proprietor confirmation instructions and supports resend", async () => {
    render(
      <TextLineCard
        initialState={snapshot({
          status: "action_needed",
          reason: "confirm_text",
          mobile: "+12065550123",
        })}
      />,
    );
    expect(
      screen.getByText(
        "Twilio sent a text to +12065550123. Reply YES within 24 hours to confirm.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send it again" }));
    await waitFor(() =>
      expect(h.resendTextLineConfirmation).toHaveBeenCalledTimes(1),
    );
  });

  it("shows pending and active state actions", () => {
    render(<TextLineCard initialState={snapshot({ status: "pending" })} />);
    expect(
      screen.getByText(
        "Waiting for carrier approval. Email reminders keep working.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Set up text reminders" }),
    ).toBeNull();

    cleanup();
    render(
      <TextLineCard
        initialState={snapshot({
          status: "active",
          phoneNumber: "+12065550100",
          available: false,
        })}
      />,
    );
    expect(
      screen.getByText("Text reminders are on. Your number is +12065550100."),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Turn off text reminders" }),
    ).toBeTruthy();
  });
});
