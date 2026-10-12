// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { VERTICALS } from "@/lib/verticals";
import { TermsProvider } from "@/lib/terms/client";
import messages from "@/i18n/messages/en.json";
import type { FieldDef } from "@/lib/custom-fields/values";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/actions/custom-fields", () => ({
  setEntityAttributes: vi.fn(),
  listCustomFieldDefinitions: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CustomFieldsCard } from "./custom-fields-card";

const hair: FieldDef = {
  id: "11111111-1111-4111-8111-111111111111",
  entity: "client",
  key: "hair_types",
  label: "Hair profile",
  type: "multi",
  options: [
    { value: "blonde", label: "Blonde" },
    { value: "red", label: "Red" },
    { value: "curly", label: "Curly" },
  ],
  isActive: true,
  showOnCard: true,
  clientEditable: true,
  matchProductTags: true,
  sort: 10,
};

afterEach(() => {
  cleanup();
});

function renderCard() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TermsProvider terms={VERTICALS.hair_salon.terms}>
        <CustomFieldsCard
          entity="client"
          ownerId="22222222-2222-4222-8222-222222222222"
          definitions={[hair]}
          values={{ hair_types: ["blonde", "curly"] }}
          canEdit
        />
      </TermsProvider>
    </NextIntlClientProvider>,
  );
}

describe("CustomFieldsCard", () => {
  it("shows the hair profile labels and presses the selected pills in edit mode", async () => {
    const user = userEvent.setup();
    renderCard();
    expect(screen.getByText("Hair profile")).toBeTruthy();
    expect(screen.getByText("Blonde, Curly")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("button", { name: "Blonde" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Red" }).getAttribute("aria-pressed")).toBe("false");
  });
});
