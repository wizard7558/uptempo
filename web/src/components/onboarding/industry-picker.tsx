"use client";

import { useT } from "@/lib/terms/client";
import { listVerticals, type VerticalId } from "@/lib/verticals";

export function IndustryPicker({
  onSelect,
}: {
  onSelect: (id: VerticalId) => void;
}) {
  const t = useT("onboarding");
  return (
    <div className="space-y-4">
      <h2 className="text-base font-medium">{t("industry.question")}</h2>
      <div className="grid gap-3">
        {listVerticals().map((pack) => {
          const label =
            pack.id === "general" ? t("industry.somethingElse") : pack.label;
          const labelId = `industry-${pack.id}`;
          return (
            <button
              key={pack.id}
              type="button"
              aria-labelledby={labelId}
              onClick={() => onSelect(pack.id)}
              className="flex min-h-14 w-full flex-col items-start justify-center gap-1 rounded-lg border border-input bg-background px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <span id={labelId} className="text-base font-medium">
                {label}
              </span>
              <span className="text-sm text-muted-foreground">{pack.description}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
