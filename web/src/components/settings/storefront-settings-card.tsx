"use client";

import { useState, useTransition } from "react";
import { useT } from "@/lib/terms/client";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Field } from "@/components/ui/field";
import {
  updateStorefrontSettings,
  type StorefrontSettings,
} from "@/actions/products";

/**
 * Retail tax + shipping controls for the storefront. Tax is shown as a percent
 * (stored as basis points) and shipping as a flat dollar rate (stored as cents),
 * with the switch off meaning pickup-only (`retailShipFlatCents: null`).
 */
export function StorefrontSettingsCard({
  initial,
}: {
  initial: StorefrontSettings;
}) {
  const t = useT("settings");
  const router = useRouter();
  const [taxPercent, setTaxPercent] = useState(
    initial.retailTaxBps === 0 ? "" : String(initial.retailTaxBps / 100),
  );
  const [offersShipping, setOffersShipping] = useState(
    initial.retailShipFlatCents !== null,
  );
  const [shipDollars, setShipDollars] = useState(
    initial.retailShipFlatCents === null
      ? ""
      : String(initial.retailShipFlatCents / 100),
  );
  const [isPending, startTransition] = useTransition();

  function save() {
    const taxTrim = taxPercent.trim();
    const taxNum = taxTrim === "" ? 0 : Number(taxTrim);
    if (!Number.isFinite(taxNum) || taxNum < 0 || taxNum > 20) {
      toast.error("Enter a sales tax between 0% and 20%.");
      return;
    }
    const retailTaxBps = Math.round(taxNum * 100);

    let retailShipFlatCents: number | null = null;
    if (offersShipping) {
      const shipTrim = shipDollars.trim();
      const shipNum = shipTrim === "" ? 0 : Number(shipTrim);
      if (!Number.isFinite(shipNum) || shipNum < 0 || shipNum > 100) {
        toast.error("Enter a flat shipping rate between $0 and $100.");
        return;
      }
      retailShipFlatCents = Math.round(shipNum * 100);
    }

    startTransition(async () => {
      const result = await updateStorefrontSettings({
        retailTaxBps,
        retailShipFlatCents,
      });
      if (result.success) {
        toast.success("Storefront settings saved.");
        router.refresh();
      } else {
        toast.error(result.message ?? "Could not save settings.");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Storefront settings</CardTitle>
        <CardDescription>
          Sales tax and shipping applied when clients check out in your retail
          storefront.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Field
          label="Sales tax (%)"
          htmlFor="retail-tax"
          description="Applied to product subtotals at checkout. Leave at 0 if you don't collect sales tax."
          className="max-w-xs"
        >
          <Input
            id="retail-tax"
            type="number"
            inputMode="decimal"
            min={0}
            max={20}
            step="0.01"
            value={taxPercent}
            onChange={(e) => setTaxPercent(e.target.value)}
            placeholder="7.25"
          />
        </Field>

        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={offersShipping}
              onCheckedChange={setOffersShipping}
            />
            Offer shipping
          </label>
          {offersShipping ? (
            <Field
              label="Flat shipping rate ($)"
              htmlFor="retail-ship"
              description="Charged once per order when a client chooses to have it shipped."
              className="max-w-xs"
            >
              <Input
                id="retail-ship"
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step="0.01"
                value={shipDollars}
                onChange={(e) => setShipDollars(e.target.value)}
                placeholder="8.00"
              />
            </Field>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("storefront.pickupOnly")}
            </p>
          )}
        </div>

        <Button
          type="button"
          onClick={save}
          disabled={isPending}
          className="w-full sm:w-auto"
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            "Save settings"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
