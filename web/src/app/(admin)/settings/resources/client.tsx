"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/lib/terms/client";
import {
  createResources,
  listResources,
  updateResource,
  type ResourceRow,
} from "@/actions/resources";
import { RESOURCE_KINDS, type ResourceKind } from "@/lib/validators/resource";

type LocationOption = { id: string; name: string };

/** Select value for "every location" (a Select item cannot have an empty value). */
const ANY_LOCATION = "any";

function toInt(value: string, fallback: number): number {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function ResourcesClient({
  initialResources,
  locations,
}: {
  initialResources: ResourceRow[];
  locations: LocationOption[];
}) {
  const t = useT("settings");
  const [resources, setResources] = useState(initialResources);
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<ResourceRow | null>(null);

  const [name, setName] = useState("");
  const [kind, setKind] = useState<ResourceKind>("room");
  const [locationId, setLocationId] = useState(ANY_LOCATION);
  const [capacity, setCapacity] = useState("1");
  const [count, setCount] = useState("1");

  const kindLabel = (k: string) => t(`resources.kinds.${k}`);

  async function refresh() {
    setResources(await listResources());
  }

  function add() {
    startTransition(async () => {
      const res = await createResources({
        name,
        kind,
        locationId: locationId === ANY_LOCATION ? null : locationId,
        capacity: toInt(capacity, 1),
        count: toInt(count, 1),
      });
      if (res.success) {
        toast.success(t("resources.saved"));
        setName("");
        setCapacity("1");
        setCount("1");
        await refresh();
      } else {
        toast.error(res.error.message);
      }
    });
  }

  function toggle(r: ResourceRow) {
    startTransition(async () => {
      const res = await updateResource({ id: r.id, isActive: r.isActive === 1 ? 0 : 1 });
      if (res.success) await refresh();
      else toast.error(res.error.message);
    });
  }

  // Group by location: "every location" first, then each location by name.
  const groups = new Map<string, { title: string; rows: ResourceRow[] }>();
  for (const r of resources) {
    const key = r.locationId ?? ANY_LOCATION;
    const title = r.locationName ?? t("resources.anyLocation");
    const g = groups.get(key) ?? { title, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  const ordered = [...groups.entries()].sort(([a, ga], [b, gb]) =>
    a === ANY_LOCATION ? -1 : b === ANY_LOCATION ? 1 : ga.title.localeCompare(gb.title),
  );

  return (
    <div className="max-w-3xl space-y-8">
      <section className="space-y-4 rounded-lg border p-4" aria-label={t("resources.add")}>
        <h2 className="text-lg font-semibold">{t("resources.add")}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="resource-name">{t("resources.name")}</Label>
            <Input
              id="resource-name"
              value={name}
              placeholder={t("resources.namePlaceholder")}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
            />
          </div>
          <KindSelect id="resource-kind" value={kind} onChange={setKind} label={t("resources.kind")} kindLabel={kindLabel} />
          <LocationSelect
            id="resource-location"
            value={locationId}
            onChange={setLocationId}
            label={t("resources.location")}
            anyLabel={t("resources.anyLocation")}
            locations={locations}
          />
          <div className="space-y-2">
            <Label htmlFor="resource-capacity">{t("resources.capacity")}</Label>
            <Input
              id="resource-capacity"
              type="number"
              min={1}
              max={500}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t("resources.capacityHint")}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="resource-count">{t("resources.count")}</Label>
            <Input
              id="resource-count"
              type="number"
              min={1}
              max={20}
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t("resources.countHint")}</p>
          </div>
        </div>
        <Button onClick={add} disabled={pending || name.trim() === ""}>
          {t("resources.save")}
        </Button>
      </section>

      {resources.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("resources.empty")}</p>
      ) : (
        ordered.map(([key, group]) => (
          <section key={key} className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground">{group.title}</h2>
            <div className="divide-y rounded-lg border bg-card">
              {group.rows.map((r) => (
                <div
                  key={r.id}
                  data-testid="resource-row"
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{r.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {kindLabel(r.kind)} · {t("resources.atOnce", { count: r.capacity })} ·{" "}
                      {r.isActive === 1 ? t("resources.on") : t("resources.off")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline"  onClick={() => setEditing(r)}>
                      {t("resources.edit")}
                    </Button>
                    <Button variant="outline"  disabled={pending} onClick={() => toggle(r)}>
                      {r.isActive === 1 ? t("resources.turnOff") : t("resources.turnOn")}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}

      {editing && (
        <EditDialog
          key={editing.id}
          resource={editing}
          locations={locations}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function KindSelect({
  id,
  value,
  onChange,
  label,
  kindLabel,
}: {
  id: string;
  value: ResourceKind;
  onChange: (k: ResourceKind) => void;
  label: string;
  kindLabel: (k: string) => string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as ResourceKind)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RESOURCE_KINDS.map((k) => (
            <SelectItem key={k} value={k}>
              {kindLabel(k)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function LocationSelect({
  id,
  value,
  onChange,
  label,
  anyLabel,
  locations,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  label: string;
  anyLabel: string;
  locations: LocationOption[];
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY_LOCATION}>{anyLabel}</SelectItem>
          {locations.map((l) => (
            <SelectItem key={l.id} value={l.id}>
              {l.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function EditDialog({
  resource,
  locations,
  onClose,
  onSaved,
}: {
  resource: ResourceRow;
  locations: LocationOption[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const t = useT("settings");
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(resource.name);
  const [kind, setKind] = useState(resource.kind as ResourceKind);
  const [locationId, setLocationId] = useState(resource.locationId ?? ANY_LOCATION);
  const [capacity, setCapacity] = useState(String(resource.capacity));

  function save() {
    startTransition(async () => {
      const res = await updateResource({
        id: resource.id,
        name,
        kind,
        locationId: locationId === ANY_LOCATION ? null : locationId,
        capacity: toInt(capacity, 1),
      });
      if (res.success) {
        toast.success(t("resources.saved"));
        await onSaved();
      } else {
        toast.error(res.error.message);
      }
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("resources.edit")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-resource-name">{t("resources.name")}</Label>
            <Input
              id="edit-resource-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
            />
          </div>
          <KindSelect
            id="edit-resource-kind"
            value={kind}
            onChange={setKind}
            label={t("resources.kind")}
            kindLabel={(k) => t(`resources.kinds.${k}`)}
          />
          <LocationSelect
            id="edit-resource-location"
            value={locationId}
            onChange={setLocationId}
            label={t("resources.location")}
            anyLabel={t("resources.anyLocation")}
            locations={locations}
          />
          <div className="space-y-2">
            <Label htmlFor="edit-resource-capacity">{t("resources.capacity")}</Label>
            <Input
              id="edit-resource-capacity"
              type="number"
              min={1}
              max={500}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t("resources.capacityHint")}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("resources.cancel")}
          </Button>
          <Button onClick={save} disabled={pending || name.trim() === ""}>
            {t("resources.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
