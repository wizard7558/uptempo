import { getDomainSettings } from "@/actions/domains";
import { DomainSettingsClient } from "./client";

export default async function DomainSettingsPage() {
  const settings = await getDomainSettings();

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Custom Domain</h1>
        <p className="text-muted-foreground mt-1">
          Connect a custom domain to your booking page for a professional URL.
        </p>
      </div>

      <DomainSettingsClient initialSettings={settings} />
    </div>
  );
}
