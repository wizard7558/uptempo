"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/lib/terms/client";
import { formatCurrency } from "@/lib/format";
import { savePackage, type PackageRow } from "@/actions/packages";

const NEVER = "never";
const EXPIRY_CHOICES = [30, 60, 90, 180, 365];

interface Props {
  initialPacks: PackageRow[];
  services: { id: string; name: string }[];
}

/** "12" or "12.50" to cents; null when it is not a price. */
function dollarsToCents(v: string): number | null {
  const s = v.trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export function PackagesClient({ initialPacks, services }: Props) {
  const t = useT("packages");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [credits, setCredits] = useState("");
  const [price, setPrice] = useState("");
  const [expires, setExpires] = useState(NEVER);
  const [eligible, setEligible] = useState<string[]>([]);
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const allServices = eligible.length === 0;

  function reset() {
    setEditingId(null);
    setName("");
    setDescription("");
    setCredits("");
    setPrice("");
    setExpires(NEVER);
    setEligible([]);
    setIsActive(true);
    setError(null);
  }

  function edit(p: PackageRow) {
    setEditingId(p.id);
    setName(p.name);
    setDescription(p.description ?? "");
    setCredits(String(p.credits));
    setPrice((p.priceCents / 100).toFixed(2));
    setExpires(p.validDays === null ? NEVER : String(p.validDays));
    setEligible(p.eligibleServiceIds);
    setIsActive(p.isActive);
    setError(null);
  }

  const expiryOptions =
    expires === NEVER || EXPIRY_CHOICES.includes(Number(expires))
      ? EXPIRY_CHOICES
      : [...EXPIRY_CHOICES, Number(expires)].sort((a, b) => a - b);

  function save() {
    setError(null);
    const priceCents = dollarsToCents(price);
    const creditCount = Number(credits);
    if (priceCents === null || !Number.isInteger(creditCount)) {
      setError(t("errors.invalid"));
      return;
    }
    startTransition(async () => {
      const res = await savePackage({
        id: editingId ?? undefined,
        name,
        description: description || null,
        priceCents,
        credits: creditCount,
        validDays: expires === NEVER ? null : Number(expires),
        eligibleServiceIds: eligible,
        isActive,
      });
      if (res.success) {
        toast.success(t("saved"));
        reset();
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {initialPacks.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("none")}</p>
          ) : (
            <ul className="divide-y">
              {initialPacks.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {t("summary", { credits: p.credits, price: formatCurrency(p.priceCents) })}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {p.validDays === null ? t("neverExpires") : t("goodFor", { days: p.validDays })}
                    </p>
                    <p className="text-sm">{p.isActive ? t("onSale") : t("notOnSale")}</p>
                  </div>
                  <Button type="button" variant="outline" className="h-11" onClick={() => edit(p)}>
                    {t("edit")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{editingId ? t("editPack") : t("add")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="pack-name">{t("name")}</Label>
            <Input id="pack-name" className="h-11" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pack-description">{t("description")}</Label>
            <Input
              id="pack-description"
              className="h-11"
              value={description}
              maxLength={500}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="pack-credits">{t("credits")}</Label>
              <Input
                id="pack-credits"
                className="h-11"
                inputMode="numeric"
                value={credits}
                onChange={(e) => setCredits(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pack-price">{t("price")}</Label>
              <Input
                id="pack-price"
                className="h-11"
                inputMode="decimal"
                placeholder="0.00"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="pack-expires">{t("expires")}</Label>
            <Select value={expires} onValueChange={setExpires}>
              <SelectTrigger id="pack-expires" className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NEVER}>{t("never")}</SelectItem>
                {expiryOptions.map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {t("days", { count: d })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <fieldset className="space-y-1">
            <legend className="mb-1 text-sm font-medium">{t("which")}</legend>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <Checkbox
                checked={allServices}
                onCheckedChange={(v) => setEligible(v === true ? [] : services.map((s) => s.id))}
              />
              {t("all")}
            </label>
            {!allServices &&
              services.map((s) => (
                <label key={s.id} className="flex min-h-11 items-center gap-2 pl-6 text-sm">
                  <Checkbox
                    checked={eligible.includes(s.id)}
                    onCheckedChange={(v) => {
                      const next = v === true ? [...eligible, s.id] : eligible.filter((x) => x !== s.id);
                      // Unticking the last one would silently mean "all", so keep one ticked.
                      setEligible(next.length === 0 ? [s.id] : next);
                    }}
                  />
                  {s.name}
                </label>
              ))}
          </fieldset>

          <div className="flex min-h-11 items-center justify-between gap-3">
            <Label htmlFor="pack-active">{isActive ? t("onSale") : t("notOnSale")}</Label>
            <Switch id="pack-active" checked={isActive} onCheckedChange={setIsActive} />
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="button"  variant="default" disabled={pending} onClick={save}>
              {t("save")}
            </Button>
            {editingId && (
              <Button type="button" variant="outline" className="h-11" onClick={reset}>
                {t("cancel")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
