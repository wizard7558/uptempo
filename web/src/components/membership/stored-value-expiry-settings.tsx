"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { setStoredValueExpiryMonths } from "@/actions/membership";
import { toast } from "sonner";
import { useT } from "@/lib/terms/client";

export function StoredValueExpirySettings({
  initialMonths,
}: {
  initialMonths: number | null;
}) {
  const t = useT("membership");
  const [enabled, setEnabled] = useState(initialMonths != null);
  const [months, setMonths] = useState(
    initialMonths != null ? String(initialMonths) : "12",
  );
  const [pending, startTransition] = useTransition();

  function save() {
    const value = enabled ? Number.parseInt(months, 10) : null;
    if (enabled && (!Number.isFinite(value) || (value ?? 0) <= 0)) {
      toast.error("Enter a valid number of months");
      return;
    }
    startTransition(async () => {
      const res = await setStoredValueExpiryMonths(value);
      if (res.success) toast.success("Expiry policy saved");
      else toast.error("Could not save expiry policy");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Credit expiry</CardTitle>
        <CardDescription>
          {t("expirySettings.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 max-w-md">
        <div className="flex items-center gap-2">
          <Switch
            id="bb-expiry-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
          <Label htmlFor="bb-expiry-enabled">Expire unused credits</Label>
        </div>
        {enabled && (
          <div className="space-y-2">
            <Label htmlFor="bb-expiry-months">Expire after (months)</Label>
            <Input
              id="bb-expiry-months"
              type="number"
              min={1}
              max={120}
              value={months}
              onChange={(e) => setMonths(e.target.value)}
            />
          </div>
        )}
        <Button onClick={save} disabled={pending}>
          {pending ? "Saving..." : "Save expiry policy"}
        </Button>
      </CardContent>
    </Card>
  );
}
