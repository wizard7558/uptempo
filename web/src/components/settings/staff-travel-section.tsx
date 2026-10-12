"use client";

import { useEffect, useState, useTransition } from "react";
import { MapPin } from "lucide-react";
import { toast } from "sonner";
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
import { getTravelSettings, saveTravelSettings } from "@/actions/on-site";

const MAX_TRAVEL = [15, 30, 45, 60, 90, 120];
const BUFFER = [0, 5, 10, 15, 30];
const SPEED = [25, 40, 55, 70];

/** Where a team member starts the day and how they drive. Needed before they can take on-site jobs. */
export function StaffTravelSection({ staffId }: { staffId: string }) {
  const t = useT("settings");
  const [loaded, setLoaded] = useState(false);
  const [zip, setZip] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [maxTravel, setMaxTravel] = useState(60);
  const [buffer, setBuffer] = useState(0);
  const [speed, setSpeed] = useState(40);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getTravelSettings(staffId).then((s) => {
      if (cancelled) return;
      if (s) {
        setZip(s.basePostalCode ?? "");
        setLat(s.basePostalCode ? "" : String(s.baseLat));
        setLng(s.basePostalCode ? "" : String(s.baseLng));
        setMaxTravel(s.maxTravelMin);
        setBuffer(s.travelBufferMin);
        setSpeed(s.speedKmh);
      }
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [staffId]);

  // Keep a saved value selectable even when it isn't one of the presets.
  const withCurrent = (opts: number[], v: number) =>
    opts.includes(v) ? opts : [...opts, v].sort((a, b) => a - b);

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await saveTravelSettings({
        staffId,
        basePostalCode: zip.trim() || undefined,
        baseLat: lat.trim() ? Number(lat) : undefined,
        baseLng: lng.trim() ? Number(lng) : undefined,
        maxTravelMin: maxTravel,
        travelBufferMin: buffer,
        speedKmh: speed,
      });
      if (res.success) toast.success(t("onSite.saved"));
      else setError(res.error);
    });
  }

  return (
    <section className="space-y-4 border-t pt-4" aria-labelledby="travel-heading">
      <h3 id="travel-heading" className="flex items-center gap-2 text-base font-semibold">
        <MapPin className="h-4 w-4" aria-hidden />
        {t("onSite.travelTitle")}
      </h3>
      <p className="text-sm text-muted-foreground">{t("onSite.travelHint")}</p>
      {loaded && (
        <>
          <div className="space-y-1">
            <Label htmlFor="travel-zip">{t("onSite.baseZip")}</Label>
            <Input
              id="travel-zip"
              className="h-11"
              value={zip}
              onChange={(e) => setZip(e.target.value)}
              inputMode="numeric"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="travel-max">{t("onSite.maxTravel")}</Label>
            <Select value={String(maxTravel)} onValueChange={(v) => setMaxTravel(Number(v))}>
              <SelectTrigger id="travel-max" className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {withCurrent(MAX_TRAVEL, maxTravel).map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {t("onSite.minutes", { count: m })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="travel-buffer">{t("onSite.buffer")}</Label>
            <Select value={String(buffer)} onValueChange={(v) => setBuffer(Number(v))}>
              <SelectTrigger id="travel-buffer" className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {withCurrent(BUFFER, buffer).map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {t("onSite.minutes", { count: m })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="travel-speed">{t("onSite.speed")}</Label>
            <Select value={String(speed)} onValueChange={(v) => setSpeed(Number(v))}>
              <SelectTrigger id="travel-speed" className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {withCurrent(SPEED, speed).map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {t("onSite.kmh", { n: m })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <details className="space-y-3">
            <summary className="cursor-pointer text-sm font-medium">{t("onSite.advanced")}</summary>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="travel-lat">{t("onSite.lat")}</Label>
                <Input id="travel-lat" className="h-11" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="travel-lng">{t("onSite.lng")}</Label>
                <Input id="travel-lng" className="h-11" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} />
              </div>
            </div>
          </details>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="button" className="h-11" disabled={pending} onClick={save}>
            {t("onSite.saveTravel")}
          </Button>
        </>
      )}
    </section>
  );
}
