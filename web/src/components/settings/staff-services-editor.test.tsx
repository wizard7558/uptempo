// @vitest-environment happy-dom
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const ui = vi.hoisted(() => ({
  setStaffServiceOffering: vi.fn(),
  removeStaffServiceOffering: vi.fn(),
  createCustomServiceForStaffMember: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/actions/staff-services", () => ({
  setStaffServiceOffering: ui.setStaffServiceOffering,
  removeStaffServiceOffering: ui.removeStaffServiceOffering,
  createCustomServiceForStaffMember: ui.createCustomServiceForStaffMember,
}));
vi.mock("@/lib/terms/client", () => ({ useT: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: ui.toast }));

import { StaffServicesEditor } from "./staff-services-editor";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

beforeAll(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(() => {
  delete reactActEnvironment.IS_REACT_ACT_ENVIRONMENT;
});

const categories = [
  {
    id: "other-id",
    slug: "other",
    name: "Other",
    sortOrder: 100,
    isDefault: true,
    isActive: true,
  },
  {
    id: "consultation-id",
    slug: "consultation",
    name: "Consultation",
    sortOrder: 10,
    isDefault: true,
    isActive: true,
  },
  {
    id: "artist-choice-id",
    slug: "artist-choice",
    name: "Artist choice",
    sortOrder: 20,
    isDefault: false,
    isActive: true,
  },
];

function serviceRow(category: string) {
  return {
    serviceId: "service-1",
    serviceName: "Custom piece",
    category,
    description: null,
    defaultDurationMinutes: 60,
    defaultPriceCents: 10000,
    defaultActiveMinutes: null,
    defaultProcessingMinutes: null,
    isLinked: true,
    isOffered: true,
    customName: null,
    overridePriceCents: null,
    overrideDurationMinutes: null,
    overrideActiveMinutes: null,
    overrideProcessingMinutes: null,
  };
}

afterEach(cleanup);

beforeEach(() => {
  vi.resetAllMocks();
  ui.setStaffServiceOffering.mockResolvedValue({ success: true });
  ui.createCustomServiceForStaffMember.mockResolvedValue({
    success: true,
    id: "created-service",
  });
});

describe("StaffServicesEditor tenant categories", () => {
  it("shows an unknown current category readably and leaves it unchanged on save", async () => {
    const user = userEvent.setup();
    render(
      <StaffServicesEditor
        staffId="staff-1"
        initialMatrix={[serviceRow("legacy_studio")]}
        categories={categories}
      />,
    );

    expect(screen.getByText("Legacy Studio")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Custom piece/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(ui.setStaffServiceOffering).toHaveBeenCalledTimes(1);
    });
    const saved = ui.setStaffServiceOffering.mock.calls[0]?.[0];
    expect(saved).not.toHaveProperty("category");
    expect(screen.getByText("Legacy Studio")).toBeTruthy();
  });

  it("creates a service with the tenant category slug and label", async () => {
    const user = userEvent.setup();
    render(
      <StaffServicesEditor
        staffId="staff-1"
        initialMatrix={[]}
        categories={categories}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Add custom service" }));
    await user.type(screen.getByLabelText("Service name"), "Portrait session");
    await act(async () => {
      await user.click(screen.getByRole("combobox"));
    });
    await act(async () => {
      await user.click(
        await screen.findByRole("option", { name: "Artist choice" }),
      );
    });
    await user.click(screen.getByRole("button", { name: "Create service" }));

    await waitFor(() => {
      expect(ui.createCustomServiceForStaffMember).toHaveBeenCalledWith(
        expect.objectContaining({
          staffId: "staff-1",
          name: "Portrait session",
          category: "artist-choice",
        }),
      );
    });
    expect(await screen.findByText("Artist choice")).toBeTruthy();
  });
});
