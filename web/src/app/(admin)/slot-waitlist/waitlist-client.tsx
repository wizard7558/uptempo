"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TZDate } from "@date-fns/tz";
import { addDays, localDay } from "@/lib/scheduling/intervals";
import {
  addToSlotWaitlist,
  removeFromSlotWaitlist,
  updateWaitlistHold,
  type WaitlistPageData,
} from "@/actions/slot-waitlist";
import { ClientSearch } from "@/components/booking/client-search";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { shortDay } from "@/lib/waitlist/clock";
import type { TimeOfDay } from "@/lib/waitlist/match";

type PickedClient = { id: string; name: string; email: string | null; phone: string | null };

const HOLDS = [10, 15, 30, 60] as const;

function windowKey(from: string, to: string): "windowAny" | "windowMorning" | "windowAfternoon" | "windowEvening" {
  if (from === "00:00" && to === "12:00") return "windowMorning";
  if (from === "12:00" && to === "17:00") return "windowAfternoon";
  if (from === "17:00" && to === "23:59") return "windowEvening";
  return "windowAny";
}

function clock(iso: string, tz: string): string {
  const z = new TZDate(new Date(iso), tz);
  const ap = z.getHours() >= 12 ? "PM" : "AM";
  let h = z.getHours() % 12;
  if (h === 0) h = 12;
  return `${h}:${String(z.getMinutes()).padStart(2, "0")} ${ap}`;
}

export function WaitlistClient({ data, canManage }: { data: WaitlistPageData; canManage: boolean }) {
  const t = useT("waitlist");
  const router = useRouter();
  const today = localDay(new Date(), data.timezone);
  const [open, setOpen] = useState(false);
  const [client, setClient] = useState<PickedClient | null>(null);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [staffId, setStaffId] = useState<string>("any");
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(addDays(today, 7));
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>("any");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hold, setHold] = useState(String(data.holdMinutes));
  const [saved, setSaved] = useState(false);

  function toggleService(id: string) {
    setServiceIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(0, 5)));
  }

  async function add() {
    if (!client || serviceIds.length === 0) return;
    setBusy(true);
    setError(null);
    const result = await addToSlotWaitlist({
      clientId: client.id,
      phone: client.phone ? undefined : phone,
      serviceIds,
      staffId: staffId === "any" ? null : staffId,
      locationId: null,
      dateFrom,
      dateTo,
      timeOfDay,
      smsConsent: consent,
    });
    setBusy(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setOpen(false);
    setClient(null);
    setServiceIds([]);
    setConsent(false);
    router.refresh();
  }

  async function remove(id: string) {
    await removeFromSlotWaitlist({ id });
    router.refresh();
  }

  async function saveHold() {
    setSaved(false);
    const result = await updateWaitlistHold(Number(hold));
    if (!result.success) {
      setError(result.error);
      return;
    }
    setSaved(true);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" className="h-12" onClick={() => setOpen(true)}>
          {t("admin.add")}
        </Button>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <Label>{t("admin.holdLabel")}</Label>
            <Select value={hold} onValueChange={setHold}>
              <SelectTrigger className="h-12 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOLDS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {t("admin.holdMinutes", { count: n })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" className="h-12" onClick={() => void saveHold()}>
              {t("admin.save")}
            </Button>
            {saved && <span className="text-sm">{t("admin.saved")}</span>}
          </div>
        )}
      </div>

      {data.rows.length === 0 ? (
        <p className="text-muted-foreground">{t("admin.empty")}</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-3">{t("admin.client")}</th>
              <th className="py-2 pr-3">{t("admin.services")}</th>
              <th className="py-2 pr-3">{t("admin.staff")}</th>
              <th className="py-2 pr-3">{t("admin.dates")}</th>
              <th className="py-2 pr-3">{t("admin.status")}</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.id} className="border-b">
                <td className="py-2 pr-3">{row.clientName}</td>
                <td className="py-2 pr-3">{row.servicesLabel}</td>
                <td className="py-2 pr-3">{row.staffName ?? t("admin.anyStaff")}</td>
                <td className="py-2 pr-3">
                  {t("admin.datesValue", {
                    from: shortDay(row.dateFrom),
                    to: shortDay(row.dateTo),
                    timeOfDay: t(`admin.${windowKey(row.timeFrom, row.timeTo)}`),
                  })}
                </td>
                <td className="py-2 pr-3">
                  {row.status === "waiting" && t("admin.statusWaiting")}
                  {row.status === "offered" &&
                    t("admin.statusOffered", {
                      time: row.offerExpiresAt ? clock(row.offerExpiresAt, data.timezone) : "",
                    })}
                  {row.status === "booked" && t("admin.statusBooked")}
                  {row.status === "expired" && t("admin.statusExpired")}
                  {row.status === "cancelled" && t("admin.statusCancelled")}
                </td>
                <td className="py-2">
                  <Button type="button" variant="outline" onClick={() => void remove(row.id)}>
                    {t("admin.remove")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.add")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t("admin.client")}</Label>
              <ClientSearch selectedClient={client} onSelect={setClient} />
            </div>
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium">{t("admin.services")}</legend>
              {data.services.map((service) => (
                <label key={service.id} className="flex items-center gap-2">
                  <Checkbox
                    checked={serviceIds.includes(service.id)}
                    onCheckedChange={() => toggleService(service.id)}
                  />
                  {service.name}
                </label>
              ))}
            </fieldset>
            <div className="space-y-1">
              <Label>{t("admin.staff")}</Label>
              <Select value={staffId} onValueChange={setStaffId}>
                <SelectTrigger className="h-12 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">{t("admin.anyStaff")}</SelectItem>
                  {data.staff.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="wl-from">{t("admin.dates")}</Label>
                <Input id="wl-from" type="date" className="h-12" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="wl-to" className="sr-only">{t("admin.dates")}</Label>
                <Input id="wl-to" type="date" className="h-12" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>{t("join.timeOfDay")}</Label>
              <Select value={timeOfDay} onValueChange={(v) => setTimeOfDay(v as TimeOfDay)}>
                <SelectTrigger className="h-12 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">{t("join.any")}</SelectItem>
                  <SelectItem value="morning">{t("join.morning")}</SelectItem>
                  <SelectItem value="afternoon">{t("join.afternoon")}</SelectItem>
                  <SelectItem value="evening">{t("join.evening")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {client && !client.phone && (
              <div className="space-y-1">
                <Label htmlFor="wl-phone">{t("join.phone")}</Label>
                <Input id="wl-phone" className="h-12" value={phone} onChange={(e) => setPhone(e.target.value)} />
                <p className="text-sm text-muted-foreground">{t("admin.noPhone")}</p>
              </div>
            )}
            <label className="flex items-start gap-2">
              <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} />
              <span>{t("admin.consentLabel")}</span>
            </label>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="h-12" onClick={() => setOpen(false)}>
              {t("join.cancel")}
            </Button>
            <Button type="button" className="h-12" disabled={busy || !client || serviceIds.length === 0} onClick={() => void add()}>
              {t("join.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
