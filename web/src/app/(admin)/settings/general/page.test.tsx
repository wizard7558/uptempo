// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement } from "react";

const h = vi.hoisted(() => ({
  singleMode: false,
  getT: vi.fn(async () => (key: string) => key),
  getBusinessSettings: vi.fn(async () => ({ timezone: "UTC" })),
  getMarketplaceListing: vi.fn(async () => false),
}));

vi.mock("@/lib/terms/server", () => ({ getT: h.getT }));
vi.mock("@/actions/policies", () => ({
  getBusinessSettings: h.getBusinessSettings,
}));
vi.mock("@/actions/marketplace", () => ({
  getMarketplaceListing: h.getMarketplaceListing,
}));
vi.mock("@/lib/config/mode", () => ({
  isSingleMode: () => h.singleMode,
}));
vi.mock("./client", () => ({ GeneralSettingsClient: () => null }));
vi.mock("./marketplace-listing-card", () => ({
  MarketplaceListingCard: () => null,
}));
vi.mock("./delete-owner-account-section", () => ({
  DeleteOwnerAccountSection: () => null,
}));

import GeneralSettingsPage from "./page";
import { MarketplaceListingCard } from "./marketplace-listing-card";

beforeEach(() => {
  vi.clearAllMocks();
  h.singleMode = false;
  h.getMarketplaceListing.mockResolvedValue(false);
});

function getMarketplaceCard(element: unknown) {
  if (!isValidElement(element)) return undefined;
  const root = element as { props: { children: unknown } };
  const children = Array.isArray(root.props.children)
    ? root.props.children
    : [root.props.children];
  return children.find(
    (child) => isValidElement(child) && child.type === MarketplaceListingCard,
  );
}

describe("GeneralSettingsPage marketplace card", () => {
  it("hides the card and skips the listing lookup in single mode", async () => {
    h.singleMode = true;

    const page = await GeneralSettingsPage();

    expect(getMarketplaceCard(page)).toBeUndefined();
    expect(h.getMarketplaceListing).not.toHaveBeenCalled();
  });

  it("shows the marketplace card in multi mode", async () => {
    h.getMarketplaceListing.mockResolvedValue(true);

    const page = await GeneralSettingsPage();
    const card = getMarketplaceCard(page);

    expect(card).toBeDefined();
    expect(card?.props).toMatchObject({ initialListed: true });
    expect(h.getMarketplaceListing).toHaveBeenCalledTimes(1);
  });
});
