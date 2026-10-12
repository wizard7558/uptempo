"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { setModuleEnabled } from "@/actions/modules";
import { MODULE_AREAS } from "@/lib/modules/catalog";
import { useT } from "@/lib/terms/client";
import { cn } from "@/lib/utils";
import type { ModuleRow } from "@/lib/tenant/modules";

export function ModulesSettingsClient({
  rows,
  industryLabel,
  offId,
}: {
  rows: ModuleRow[];
  industryLabel: string;
  offId?: string;
}) {
  const t = useT("modules");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, r.enabled])),
  );

  const offRow = offId ? rows.find((r) => r.id === offId) : undefined;
  const nameOf = (id: string) => t(`items.${id}.name`);

  function toggle(row: ModuleRow, next: boolean) {
    const name = nameOf(row.id);
    setEnabled((prev) => ({ ...prev, [row.id]: next }));
    startTransition(async () => {
      let ok = false;
      try {
        const res = await setModuleEnabled(row.id, next);
        ok = res.success;
      } catch {
        ok = false;
      }
      if (!ok) {
        setEnabled((prev) => ({ ...prev, [row.id]: !next }));
        toast.error(t("page.failed"));
        return;
      }
      toast.success(t(next ? "page.turnedOn" : "page.turnedOff", { name }));
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {offRow ? (
        <div
          role="status"
          className="rounded-lg border border-primary/40 bg-primary/5 p-4 text-sm"
        >
          {t("page.offNotice", { name: nameOf(offRow.id) })}
        </div>
      ) : null}

      {MODULE_AREAS.map((area) => {
        const areaRows = rows.filter((r) => r.area === area);
        if (areaRows.length === 0) return null;
        return (
          <Card key={area}>
            <CardHeader>
              <CardTitle>{t(`areas.${area}`)}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {areaRows.map((row) => {
                const name = nameOf(row.id);
                const alwaysOn = row.availability === "always_on";
                const switchId = `module-${row.id}`;
                return (
                  <label
                    key={row.id}
                    id={row.id}
                    htmlFor={switchId}
                    className={cn(
                      "flex min-h-11 items-center justify-between gap-4 rounded-lg border p-3",
                      alwaysOn ? "cursor-default" : "cursor-pointer",
                      offRow?.id === row.id && "ring-2 ring-primary",
                    )}
                  >
                    <span className="min-w-0 space-y-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-bold">{name}</span>
                        {row.recommended ? (
                          <Badge variant="outline">
                            {t("page.recommended", { industry: industryLabel })}
                          </Badge>
                        ) : null}
                      </span>
                      <span className="block text-sm text-muted-foreground">
                        {t(`items.${row.id}.description`)}
                      </span>
                      {alwaysOn ? (
                        <span className="block text-sm text-muted-foreground">
                          {t("page.alwaysOn")}
                        </span>
                      ) : null}
                    </span>
                    {alwaysOn ? (
                      <Switch
                        id={switchId}
                        checked
                        disabled
                        aria-label={t("page.switchLabel", { name })}
                      />
                    ) : (
                      <Switch
                        id={switchId}
                        checked={enabled[row.id] ?? false}
                        onCheckedChange={(next) => toggle(row, next)}
                        aria-label={t("page.switchLabel", { name })}
                      />
                    )}
                  </label>
                );
              })}
            </CardContent>
          </Card>
        );
      })}

      <p className="text-sm text-muted-foreground">{t("page.moreComing")}</p>
    </div>
  );
}
