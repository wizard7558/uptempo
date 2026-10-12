import { requireRole } from "@/lib/auth/rbac";
import { listCustomFieldDefinitions } from "@/actions/custom-fields";
import { listProducts, getStorefrontSettings } from "@/actions/products";
import { listOrders } from "@/actions/orders";
import { SettingsPageShell } from "@/components/settings/settings-page-shell";
import { StorefrontSettingsCard } from "@/components/settings/storefront-settings-card";
import { OrdersList } from "@/components/settings/orders-list";
import { ProductsClient } from "./client";
import { requireModule } from "@/lib/tenant/modules";

export default async function ProductsPage() {
  await requireRole("owner");
  await requireModule("storefront");
  const [products, storefrontSettings, orders, definitions] = await Promise.all([
    listProducts(),
    getStorefrontSettings(),
    listOrders(),
    listCustomFieldDefinitions("client"),
  ]);
  const seen = new Set<string>();
  const tagOptions: { value: string; label: string }[] = [];
  for (const def of definitions) {
    if (!def.matchProductTags) continue;
    for (const option of def.options) {
      if (seen.has(option.value)) continue;
      seen.add(option.value);
      tagOptions.push(option);
    }
  }

  return (
    <SettingsPageShell
      title="Storefront"
      description="Retail products you sell. Add the products you keep stocked and tag them so the right ones are recommended first."
    >
      <ProductsClient initialProducts={products} tagOptions={tagOptions} />
      <StorefrontSettingsCard initial={storefrontSettings} />
      <OrdersList initialOrders={orders} />
    </SettingsPageShell>
  );
}
