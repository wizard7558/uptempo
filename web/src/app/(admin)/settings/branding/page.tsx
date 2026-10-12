import { getBrandingSettings } from "@/actions/branding";
import { getT } from "@/lib/terms/server";
import { BrandingSettingsForm } from "./client";

export default async function BrandingSettingsPage() {
  const t = await getT("settings");
  const settings = await getBrandingSettings();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">{t("branding.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("branding.subtitle")}</p>
      </div>

      <BrandingSettingsForm initialSettings={settings} />
    </div>
  );
}
