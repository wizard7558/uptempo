"use client";

import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/lib/terms/client";
import { RESOURCE_KINDS, type ServiceNeedInput } from "@/lib/validators/resource";

export type ResourceOption = { id: string; name: string; kind: string };

const START_OPTIONS = [0, 15, 30, 45, 60, 90, 120];
const LENGTH_OPTIONS = [15, 30, 45, 60, 90, 120];
const WHOLE = "whole";

/** A need's target as one Select value: "kind:chair" or "id:<resource id>". */
function targetOf(n: ServiceNeedInput): string {
  return n.resourceId ? `id:${n.resourceId}` : `kind:${n.resourceKind}`;
}

function withCurrent(options: number[], current: number): number[] {
  return options.includes(current) ? options : [...options, current].sort((a, b) => a - b);
}

/**
 * "What this service needs": rooms and equipment the service holds while it runs.
 * Only types that have an active resource can be picked. A need already saved for
 * something that has since been turned off stays editable so it can be removed.
 */
export function ServiceNeeds({
  needs,
  onChange,
  resources,
}: {
  needs: ServiceNeedInput[];
  onChange: (needs: ServiceNeedInput[]) => void;
  resources: ResourceOption[];
}) {
  const t = useT("schedule");
  const ts = useT("settings");
  const kindsOffered = RESOURCE_KINDS.filter((k) => resources.some((r) => r.kind === k));

  const update = (i: number, patch: Partial<ServiceNeedInput>) =>
    onChange(needs.map((n, j) => (j === i ? { ...n, ...patch } : n)));

  const add = () => {
    const first = kindsOffered[0];
    if (!first) return;
    onChange([
      ...needs,
      { resourceKind: first, resourceId: null, quantity: 1, offsetMin: 0, durationMin: null },
    ]);
  };

  const setTarget = (i: number, value: string) => {
    if (value.startsWith("id:")) {
      update(i, { resourceKind: null, resourceId: value.slice(3), quantity: 1 });
    } else {
      update(i, { resourceKind: value.slice(5) as ServiceNeedInput["resourceKind"], resourceId: null });
    }
  };

  return (
    <div className="space-y-4 rounded-lg border p-4" data-testid="service-needs">
      <p className="text-sm font-medium">{t("serviceList.needs.title")}</p>

      {needs.map((n, i) => {
        const target = targetOf(n);
        const known =
          n.resourceId != null
            ? resources.some((r) => r.id === n.resourceId)
            : kindsOffered.includes(n.resourceKind as (typeof RESOURCE_KINDS)[number]);
        return (
          <div
            key={i}
            data-testid="need-row"
            className="grid items-end gap-3 sm:grid-cols-[1.5fr_0.7fr_1fr_1.2fr_auto]"
          >
            <div className="space-y-2">
              <Label htmlFor={`need-type-${i}`}>{t("serviceList.needs.type")}</Label>
              <Select value={target} onValueChange={(v) => setTarget(i, v)}>
                <SelectTrigger id={`need-type-${i}`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {!known && (
                    <SelectItem value={target}>
                      {n.resourceId ? n.resourceId : ts(`resources.kinds.${n.resourceKind}`)}
                    </SelectItem>
                  )}
                  {kindsOffered.map((k) => (
                    <SelectItem key={k} value={`kind:${k}`}>
                      {ts(`resources.kinds.${k}`)}
                    </SelectItem>
                  ))}
                  {resources.map((r) => (
                    <SelectItem key={r.id} value={`id:${r.id}`}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`need-qty-${i}`}>{t("serviceList.needs.quantity")}</Label>
              <Input
                id={`need-qty-${i}`}
                type="number"
                min={1}
                max={20}
                disabled={n.resourceId != null}
                value={n.quantity}
                onChange={(e) =>
                  update(i, { quantity: Math.min(20, Math.max(1, parseInt(e.target.value, 10) || 1)) })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={`need-start-${i}`}>{t("serviceList.needs.startsAfter")}</Label>
              <Select
                value={String(n.offsetMin)}
                onValueChange={(v) => update(i, { offsetMin: parseInt(v, 10) })}
              >
                <SelectTrigger id={`need-start-${i}`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {withCurrent(START_OPTIONS, n.offsetMin).map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {t("serviceList.needs.minutes", { count: m })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`need-length-${i}`}>{t("serviceList.needs.forHowLong")}</Label>
              <Select
                value={n.durationMin == null ? WHOLE : String(n.durationMin)}
                onValueChange={(v) => update(i, { durationMin: v === WHOLE ? null : parseInt(v, 10) })}
              >
                <SelectTrigger id={`need-length-${i}`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={WHOLE}>{t("serviceList.needs.wholeService")}</SelectItem>
                  {withCurrent(LENGTH_OPTIONS, n.durationMin ?? 0)
                    .filter((m) => m > 0)
                    .map((m) => (
                      <SelectItem key={m} value={String(m)}>
                        {t("serviceList.needs.minutes", { count: m })}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              type="button"
              variant="outline"
              
              onClick={() => onChange(needs.filter((_, j) => j !== i))}
            >
              {t("serviceList.needs.remove")}
            </Button>
          </div>
        );
      })}

      {kindsOffered.length > 0 ? (
        <Button type="button" variant="outline"  onClick={add}>
          <PlusIcon className="mr-2 size-4" />
          {t("serviceList.needs.add")}
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("serviceList.needs.noResources")}{" "}
          <Link href="/settings/resources" className="text-primary underline underline-offset-4">
            {t("serviceList.needs.settingsLink")}
          </Link>
        </p>
      )}
    </div>
  );
}
