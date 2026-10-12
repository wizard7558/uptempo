// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { VERTICALS } from "@/lib/verticals";
import { TermsProvider } from "@/lib/terms/client";
import messages from "@/i18n/messages/en.json";
import type { QueueEntryView } from "./status-client";

vi.mock("@/actions/queue-public", () => ({ leaveQueue: vi.fn() }));

import { StatusClient } from "./status-client";

const TOKEN = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function entry(over: Partial<QueueEntryView>): QueueEntryView {
  return {
    status: "waiting",
    position: 3,
    waitMinutes: 25,
    staffName: null,
    businessName: "Test Salon",
    ...over,
  };
}

function renderStatus(view: QueueEntryView) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(view)),
  );
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TermsProvider terms={VERTICALS.hair_salon.terms}>
        <StatusClient slug="test-salon" token={TOKEN} initial={view} />
      </TermsProvider>
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("StatusClient", () => {
  it("says the place and the wait in one sentence", async () => {
    renderStatus(entry({ position: 3, waitMinutes: 25 }));
    expect((await screen.findByRole("status")).textContent).toBe("You're number 3. About 25 minutes.");
  });

  it("says it is almost their turn when the wait is five minutes or less", async () => {
    renderStatus(entry({ position: 1, waitMinutes: 0 }));
    expect((await screen.findByRole("status")).textContent).toBe("You're number 1. It's almost your turn.");
  });
});
