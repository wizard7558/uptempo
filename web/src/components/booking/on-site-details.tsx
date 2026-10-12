"use client";

import { useState } from "react";
import { addMinutes, format } from "date-fns";
import { Loader2, MapPin, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/lib/terms/client";
import { sendOnMyWay } from "@/actions/on-site";
import type { AppointmentData } from "@/components/schedule/appointment-block";

const ETA_CHOICES = [10, 15, 20, 30, 45, 60];

/** The address, arrival window and "On my way" text for an on-site job. */
export function OnSiteDetails({ appointment }: { appointment: AppointmentData }) {
  const t = useT("schedule");
  const [open, setOpen] = useState(false);
  const [eta, setEta] = useState(15);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<Date | null>(appointment.onMyWaySentAt ?? null);
  const [alreadySent, setAlreadySent] = useState(false);

  const a = appointment.serviceAddress;
  if (!a) return null;

  const street = [a.line1, a.line2].filter(Boolean).join(", ");
  const full = [street, a.city, [a.region, a.postalCode].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  const window = appointment.arrivalWindowMin ?? 0;

  async function send() {
    setSending(true);
    setError(null);
    const res = await sendOnMyWay({ appointmentId: appointment.id, etaMinutes: eta });
    setSending(false);
    if (!res.success) {
      setError(res.error);
      return;
    }
    if (res.alreadySent) setAlreadySent(true);
    else {
      setSentAt(new Date());
      toast.success(t("onSite.sent"));
    }
    setOpen(false);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" />
        <div className="text-sm">
          <div className="font-medium">{t("onSite.address")}</div>
          <div>{[street, a.city].filter(Boolean).join(", ")}</div>
          <a
            className="text-primary underline"
            href={`https://maps.google.com/?q=${encodeURIComponent(full)}`}
            target="_blank"
            rel="noreferrer"
          >
            {t("onSite.openMaps")}
          </a>
          {window > 0 && (
            <div className="mt-1 text-muted-foreground">
              {t("onSite.arrival", {
                start: format(appointment.start, "h:mm a"),
                end: format(addMinutes(appointment.start, window), "h:mm a"),
              })}
            </div>
          )}
        </div>
      </div>

      {appointment.status === "confirmed" && (
        <div className="space-y-1">
          <Button type="button" variant="outline" className="h-11 w-full" onClick={() => setOpen(true)}>
            <MessageSquare className="mr-2 h-4 w-4" aria-hidden />
            {t("onSite.onMyWay")}
          </Button>
          {sentAt && (
            <p className="text-sm text-muted-foreground">
              {t("onSite.sentAt", { time: format(sentAt, "h:mm a") })}
            </p>
          )}
          {alreadySent && <p className="text-sm text-muted-foreground">{t("onSite.alreadySent")}</p>}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("onSite.onMyWay")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="eta-minutes">{t("onSite.etaQuestion")}</Label>
            <Select value={String(eta)} onValueChange={(v) => setEta(Number(v))}>
              <SelectTrigger id="eta-minutes" className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ETA_CHOICES.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {t("onSite.etaMinutes", { count: m })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={() => setOpen(false)}>
              {t("onSite.cancel")}
            </Button>
            <Button type="button" className="h-11" disabled={sending} onClick={send}>
              {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              {t("onSite.send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
