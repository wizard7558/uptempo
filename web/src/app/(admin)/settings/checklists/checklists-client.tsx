"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveChecklistTemplate } from "@/actions/checklists";
import type { ChecklistTemplateRow } from "@/lib/checklists/service";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/terms/client";

type DraftItem = { key: string; id?: string; label: string };

function draftsFrom(items: ChecklistTemplateRow["items"]): DraftItem[] {
  return items.map((item) => ({ key: item.id, id: item.id, label: item.label }));
}

function ServiceChecklistCard({ row }: { row: ChecklistTemplateRow }) {
  const t = useT("appointmentWork");
  const [items, setItems] = useState<DraftItem[]>(() => draftsFrom(row.items));
  const [pending, startTransition] = useTransition();

  function move(index: number, direction: -1 | 1) {
    const next = index + direction;
    if (next < 0 || next >= items.length) return;
    const copy = items.slice();
    const [item] = copy.splice(index, 1);
    copy.splice(next, 0, item);
    setItems(copy);
  }

  function save() {
    startTransition(async () => {
      const result = await saveChecklistTemplate({
        serviceId: row.serviceId,
        items: items.map(({ id, label }) => (id ? { id, label } : { label })),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setItems(draftsFrom(result.items));
      toast.success(t("settings.saved"));
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.itemsFor", { service: row.serviceName })}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("settings.noItems")}</p>
        ) : (
          items.map((item, index) => (
            <div key={item.key} className="flex flex-wrap items-center gap-2">
              <Input
                value={item.label}
                placeholder={t("settings.itemPlaceholder")}
                aria-label={t("settings.itemPlaceholder")}
                onChange={(event) => {
                  const label = event.target.value;
                  setItems((current) =>
                    current.map((draft) => (draft.key === item.key ? { ...draft, label } : draft)),
                  );
                }}
              />
              <Button
                type="button"
                variant="outline"
                
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                {t("settings.moveUp")}
              </Button>
              <Button
                type="button"
                variant="outline"
                
                disabled={index === items.length - 1}
                onClick={() => move(index, 1)}
              >
                {t("settings.moveDown")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                
                onClick={() =>
                  setItems((current) => current.filter((draft) => draft.key !== item.key))
                }
              >
                {t("settings.remove")}
              </Button>
            </div>
          ))
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setItems((current) => [...current, { key: crypto.randomUUID(), label: "" }])
            }
          >
            {t("settings.addItem")}
          </Button>
          <Button type="button" onClick={save} disabled={pending}>
            {t("settings.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function ChecklistsClient({ templates }: { templates: ChecklistTemplateRow[] }) {
  return (
    <div className="space-y-4">
      {templates.map((row) => (
        <ServiceChecklistCard key={row.serviceId} row={row} />
      ))}
    </div>
  );
}
