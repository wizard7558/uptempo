import { getT } from "@/lib/terms/server";
import { getBusinessSettings } from "@/actions/policies";
import { getMarketplaceListing } from "@/actions/marketplace";
import { GeneralSettingsClient } from "./client";
import { MarketplaceListingCard } from "./marketplace-listing-card";
import { DeleteOwnerAccountSection } from "./delete-owner-account-section";

export default async function GeneralSettingsPage() {
  const t = await getT("settings");
  const policy = await getBusinessSettings();
  const listedInMarketplace = await getMarketplaceListing();

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">General Settings</h1>
        <p className="text-muted-foreground mt-1">
          {t("generalPage.subtitle")}
        </p>
      </div>

      <GeneralSettingsClient initialTimezone={policy.timezone} />

      <MarketplaceListingCard initialListed={listedInMarketplace} />

      <DeleteOwnerAccountSection />
    </div>
  );
}
