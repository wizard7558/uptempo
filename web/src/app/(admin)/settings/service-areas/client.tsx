"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/lib/terms/client";
import {
  saveArrivalWindow,
  saveServiceArea,
  setServiceAreaActive,
  type ServiceAreaView,
} from "@/actions/on-site";

const ARRIVAL_CHOICES = [0, 30, 60, 120, 180, 240];
const EVERYONE = "everyone";

type Kind = "postal_codes" | "radius";

interface Props {
  initialAreas: ServiceAreaView[];
  arrivalWindowMin: number;
  staff: { id: string; displayName: string }[];
}

export function ServiceAreasClient({ initialAreas, arrivalWindowMin, staff }: Props) {
  const t = useT("settings");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Area form
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("postal_codes");
  const [zips, setZips] = useState("");
  const [centerZip, setCenterZip] = useState("");
  const [distance, setDistance] = useState("");
  const [appliesTo, setAppliesTo] = useState(EVERYONE);
  const [error, setError] = useState<string | null>(null);

  // Arrival window
  const [arrival, setArrival] = useState(arrivalWindowMin);

  const arrivalLabel = (m: number) =>
    m === 0
      ? t("onSite.exact")
      : m < 60
        ? t("onSite.minutes", { count: m })
        : t("onSite.hours", { count: m / 60 });
  const arrivalOptions = ARRIVAL_CHOICES.includes(arrival)
    ? ARRIVAL_CHOICES
    : [...ARRIVAL_CHOICES, arrival].sort((a, b) => a - b);

  function reset() {
    setEditingId(null);
    setName("");
    setKind("postal_codes");
    setZips("");
    setCenterZip("");
    setDistance("");
    setAppliesTo(EVERYONE);
    setError(null);
  }

  function edit(a: ServiceAreaView) {
    setEditingId(a.id);
    setName(a.name);
    setKind(a.kind);
    setZips(a.postalCodes.join(", "));
    setCenterZip(a.centerPostal ?? "");
    setDistance(a.radiusKm == null ? "" : String(a.radiusKm));
    setAppliesTo(a.staffId ?? EVERYONE);
    setError(null);
  }

  function summary(a: ServiceAreaView): string {
    const base =
      a.kind === "postal_codes"
        ? t("onSite.areaSummaryZips", { count: a.postalCodes.length })
        : t("onSite.areaSummaryRadius", { km: a.radiusKm ?? 0, zip: a.centerPostal ?? "" });
    return a.staffName ? `${base} - ${t("onSite.areaOnlyFor", { name: a.staffName })}` : base;
  }

  function saveArea() {
    setError(null);
    startTransition(async () => {
      const res = await saveServiceArea({
        id: editingId ?? undefined,
        name,
        staffId: appliesTo === EVERYONE ? null : appliesTo,
        kind,
        ...(kind === "postal_codes"
          ? { postalCodes: zips.split(/[\s,;]+/).filter(Boolean) }
          : { centerPostal: centerZip, radiusKm: Number(distance) }),
      });
      if (res.success) {
        toast.success(t("onSite.saved"));
        reset();
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  function toggle(a: ServiceAreaView) {
    startTransition(async () => {
      const res = await setServiceAreaActive(a.id, !a.isActive);
      if (res.success) router.refresh();
      else toast.error(res.error);
    });
  }

  function saveArrival() {
    startTransition(async () => {
      const res = await saveArrivalWindow(arrival);
      if (res.success) toast.success(t("onSite.saved"));
      else toast.error(res.error);
    });
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("onSite.areasTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {initialAreas.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("onSite.noAreas")}</p>
          ) : (
            <ul className="divide-y">
              {initialAreas.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-medium">{a.name}</p>
                    <p className="text-sm text-muted-foreground">{summary(a)}</p>
                    <p className="text-sm">{a.isActive ? t("onSite.on") : t("onSite.off")}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" className="h-11" onClick={() => edit(a)}>
                      {t("onSite.edit")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11"
                      disabled={pending}
                      onClick={() => toggle(a)}
                    >
                      {a.isActive ? t("onSite.turnOff") : t("onSite.turnOn")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{editingId ? t("onSite.editArea") : t("onSite.addArea")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="area-name">{t("onSite.name")}</Label>
            <Input id="area-name" className="h-11" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t("onSite.howToSet")}</legend>
            {(["postal_codes", "radius"] as const).map((k) => (
              <label key={k} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="area-kind"
                  checked={kind === k}
                  onChange={() => setKind(k)}
                />
                {k === "postal_codes" ? t("onSite.byZips") : t("onSite.byRadius")}
              </label>
            ))}
          </fieldset>

          {kind === "postal_codes" ? (
            <div className="space-y-1">
              <Label htmlFor="area-zips">{t("onSite.zips")}</Label>
              <Textarea id="area-zips" rows={4} value={zips} onChange={(e) => setZips(e.target.value)} />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="area-center">{t("onSite.centerZip")}</Label>
                <Input
                  id="area-center"
                  className="h-11"
                  inputMode="numeric"
                  value={centerZip}
                  onChange={(e) => setCenterZip(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="area-distance">{t("onSite.distance")}</Label>
                <Input
                  id="area-distance"
                  className="h-11"
                  inputMode="decimal"
                  value={distance}
                  onChange={(e) => setDistance(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="area-applies">{t("onSite.appliesTo")}</Label>
            <Select value={appliesTo} onValueChange={setAppliesTo}>
              <SelectTrigger id="area-applies" className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={EVERYONE}>{t("onSite.everyone")}</SelectItem>
                {staff.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="button"  variant="default" disabled={pending} onClick={saveArea}>
              {t("onSite.saveArea")}
            </Button>
            {editingId && (
              <Button type="button" variant="outline" className="h-11" onClick={reset}>
                {t("onSite.cancel")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("onSite.arrivalTitle")}</CardTitle>
          <CardDescription>{t("onSite.arrivalHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select value={String(arrival)} onValueChange={(v) => setArrival(Number(v))}>
            <SelectTrigger aria-label={t("onSite.arrivalTitle")} className="h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {arrivalOptions.map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {arrivalLabel(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button"  variant="default" disabled={pending} onClick={saveArrival}>
            {t("onSite.saveArrival")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
