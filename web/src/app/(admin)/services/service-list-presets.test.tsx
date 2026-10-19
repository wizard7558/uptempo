// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getServicePresetsForIndustry } from "@/lib/services/preset-catalog";
import type { ServicePreset } from "@/lib/services/preset-catalog";

const uiMocks = vi.hoisted(() => ({
  createService: vi.fn(),
  updateService: vi.fn(),
  deleteService: vi.fn(),
  importServicePresets: vi.fn(),
  setServiceNeeds: vi.fn(),
}));

vi.mock("@/actions/services", () => uiMocks);
vi.mock("@/actions/service-categories", () => ({ createServiceCategory: vi.fn() }));
vi.mock("@/actions/service-addons", () => ({ setServiceAddons: vi.fn() }));
vi.mock("@/lib/terms/client", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ServiceList } from "./service-list";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.resetAllMocks();
  uiMocks.importServicePresets.mockResolvedValue({
    success: true,
    ids: ["created-service"],
  });
});

function renderServiceList(
  preset: ServicePreset,
  category: { id: string; slug: string; name: string } | null,
) {
  return render(
    <ServiceList
      initialServices={[]}
      assistantSettingsEnabled={false}
      taskTypes={[]}
      offeringCounts={{}}
      availablePresets={[preset]}
      categories={category ? [category] : []}
      addonsByService={{}}
      resources={[]}
      needsByService={{}}
      classesEnabled
    />,
  );
}

describe("service list industry presets", () => {
  it("uses the tenant category label and displays an imported tattoo deposit", async () => {
    const user = userEvent.setup();
    const preset = getServicePresetsForIndustry("tattoo").find(
      (candidate) => candidate.name === "Small piece",
    );
    expect(preset).toBeDefined();
    renderServiceList(preset!, {
      id: "category-custom",
      slug: preset!.category,
      name: "Tattoo and body art",
    });

    await user.click(screen.getByRole("button", { name: "Add common services" }));
    expect(screen.getByText("Tattoo and body art")).toBeTruthy();
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Add 1 service" }));

    expect(await screen.findByText("Small piece")).toBeTruthy();
    expect(await screen.findByText("Deposit $50.00")).toBeTruthy();
    expect(screen.getByText("Tattoo and body art")).toBeTruthy();
    expect(uiMocks.importServicePresets).toHaveBeenCalledWith([preset!.key]);
  });

  it("keeps imported personal-training class capacity in the optimistic service row", async () => {
    const user = userEvent.setup();
    const preset = getServicePresetsForIndustry("personal_training").find(
      (candidate) => candidate.name === "Bootcamp",
    );
    expect(preset).toBeDefined();
    renderServiceList(preset!, {
      id: "category-classes",
      slug: preset!.category,
      name: "Trainer classes",
    });

    await user.click(screen.getByRole("button", { name: "Add common services" }));
    expect(screen.getByText("Trainer classes")).toBeTruthy();
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Add 1 service" }));
    expect(await screen.findByText("Bootcamp")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Edit Bootcamp" }));
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "isClass" }).getAttribute("aria-checked")).toBe(
        "true",
      );
    });
    expect((screen.getByLabelText("spotsPerClass") as HTMLInputElement).value).toBe("12");
    expect(uiMocks.importServicePresets).toHaveBeenCalledWith([preset!.key]);
  });

  it("uses a neutral label for a category with no tenant label", async () => {
    const user = userEvent.setup();
    const preset = {
      ...getServicePresetsForIndustry("hair_salon")[0],
      category: "cut",
    };
    renderServiceList(preset, null);

    await user.click(screen.getByRole("button", { name: "Add common services" }));

    expect(screen.getByText("Other")).toBeTruthy();
  });
});
