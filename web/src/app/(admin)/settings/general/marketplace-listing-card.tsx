"use client";

import { useState, useTransition } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useT } from "@/lib/terms/client";
import { setMarketplaceListing } from "@/actions/marketplace";

/**
 * Owner toggle: opt the salon into the public client app marketplace, where
 * clients can discover and book it from the Uptempo iOS app. Off by default.
 */
export function MarketplaceListingCard({ initialListed }: { initialListed: boolean }) {
  const t = useT("settings");
  const [listed, setListed] = useState(initialListed);
  const [pending, startTransition] = useTransition();

  function handleChange(next: boolean) {
    const previous = listed;
    setListed(next); // optimistic
    startTransition(async () => {
      try {
        await setMarketplaceListing(next);
        toast.success(
          next ? t("marketplace.listed") : "Removed from the app marketplace.",
        );
      } catch {
        setListed(previous);
        toast.error("Couldn't update marketplace listing. Please try again.");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>App marketplace</CardTitle>
        <CardDescription>
          {t("marketplace.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3">
          <Switch
            id="marketplace-listing"
            checked={listed}
            onCheckedChange={handleChange}
            disabled={pending}
          />
          <Label htmlFor="marketplace-listing">
            {listed ? "Listed in the app" : "Not listed"}
          </Label>
        </div>
      </CardContent>
    </Card>
  );
}
