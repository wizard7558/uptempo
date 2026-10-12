"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ClientSearch } from "./client-search";
import { ServiceSelector } from "./service-selector";
import { useBookingForm } from "@/hooks/use-booking-form";
import { createBooking, createBookingGroup, createRecurringBooking } from "@/actions/appointments";
import { listServices, fetchMultiServiceDuration } from "@/actions/services";
import { listStaff } from "@/actions/staff";
import { getClient } from "@/actions/clients";
import { getStaffLocations } from "@/actions/locations";
import type { ServiceDurationInfo } from "@/lib/services/duration";
import { toast } from "sonner";
import { BOOKING_TIME_OPTIONS } from "@/lib/booking/time-options";
import { useT } from "@/lib/terms/client";

interface StaffMember {
  id: string;
  displayName: string;
  services: { serviceId: string; serviceName: string }[];
}

type PanelClient = { id: string; name: string; email: string | null; phone: string | null };

/** One more person in a group booking (the main form is the first person). */
interface ExtraPerson {
  key: number;
  sameClient: boolean;
  client: PanelClient | null;
  staffId: string | null;
  serviceIds: string[];
  starts: "same" | "after";
}

interface BookingPanelProps {
  open: boolean;
  onClose: () => void;
  staffId: string | null;
  startTime: Date | null;
  staff: StaffMember[];
  onBookingCreated: () => void;
}

export function BookingPanel({
  open,
  onClose,
  staffId,
  startTime,
  staff,
  onBookingCreated,
}: BookingPanelProps) {
  const t = useT("schedule");
  const form = useBookingForm(staffId, startTime);
  // "Book the next session" from a project arrives as /schedule?client=<id>&projectId=<id>.
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryProjectId = searchParams.get("projectId");
  const queryClientId = searchParams.get("client");
  const {
    locationId,
    setLocationId,
    setStartTime,
    setStaffId,
    reset,
    staffId: selectedStaffId,
  } = form;
  const [allServices, setAllServices] = useState<
    { id: string; name: string; defaultDurationMinutes: number }[]
  >([]);
  const [liveStaffServices, setLiveStaffServices] = useState<
    Map<string, { serviceId: string; serviceName: string }[]>
  >(
    () =>
      new Map(staff.map((s) => [s.id, s.services] as const)),
  );
  const [locations, setLocations] = useState<
    { id: string; name: string; address: string | null }[]
  >([]);
  const [resolvedByService, setResolvedByService] = useState<
    Map<string, ServiceDurationInfo>
  >(new Map());
  const [isMobile, setIsMobile] = useState(false);
  const [extras, setExtras] = useState<ExtraPerson[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const [repeat, setRepeat] = useState<"none" | "weekly" | "biweekly">("none");
  const [endsAfter, setEndsAfter] = useState<number | null>(null);
  const [seriesResult, setSeriesResult] = useState<{ created: number; conflicts: string[] } | null>(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([listServices(), listStaff()]).then(([svc, fresh]) => {
      if (cancelled) return;
      setAllServices(svc);
      setLiveStaffServices(
        new Map(fresh.map((s) => [s.id, s.services] as const)),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!selectedStaffId) {
      setLocations([]);
      return;
    }

    let cancelled = false;
    getStaffLocations(selectedStaffId).then((data) => {
      if (cancelled) return;

      setLocations(data);
      if (data.length === 1) {
        setLocationId(data[0].id);
      } else if (
        locationId &&
        !data.some((location) => location.id === locationId)
      ) {
        setLocationId(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [locationId, selectedStaffId, setLocationId]);

  const dateValue = useMemo(
    () => (form.startTime ? format(form.startTime, "yyyy-MM-dd") : ""),
    [form.startTime],
  );

  const timeValue = useMemo(() => {
    if (!form.startTime) return "";
    const h = form.startTime.getHours().toString().padStart(2, "0");
    const m = form.startTime.getMinutes().toString().padStart(2, "0");
    return `${h}:${m}`;
  }, [form.startTime]);

  // Reset form when panel opens with new data
  useEffect(() => {
    if (open) {
      reset();
      setExtras([]);
      setRepeat("none");
      setEndsAfter(null);
      setSeriesResult(null);
      if (staffId) setStaffId(staffId);
      if (startTime) setStartTime(startTime);
    }
  }, [open, reset, setStartTime, setStaffId, startTime, staffId]);

  // Pre-select the project's client.
  const setFormClient = form.setClient;
  useEffect(() => {
    if (!open || !queryProjectId || !queryClientId) return;
    let cancelled = false;
    getClient(queryClientId).then((c) => {
      if (cancelled || !c) return;
      setFormClient({ id: c.id, name: c.name, email: c.email, phone: c.phone });
    });
    return () => {
      cancelled = true;
    };
  }, [open, queryProjectId, queryClientId, setFormClient]);

  // The booking joins the project only while the chosen client is the project's client.
  const projectId =
    queryProjectId && queryClientId && form.selectedClient?.id === queryClientId ? queryProjectId : null;

  // Filter services to those assigned to selected stylist. Prefer the freshly
  // fetched assignments (updated when the panel opens) over the schedule page's
  // initial prop, so newly-added services appear without a full reload.
  const selectedStaffServices = form.staffId
    ? (liveStaffServices.get(form.staffId) ??
      staff.find((s) => s.id === form.staffId)?.services)
    : undefined;
  const availableServices = selectedStaffServices
    ? allServices.filter((svc) =>
        selectedStaffServices.some((ss) => ss.serviceId === svc.id),
      )
    : allServices;

  // Pre-resolve durations + prices for every service in the list as soon as
  // a client (and optionally stylist) is known. This way the rows in the
  // service picker show the client's custom duration/price up front — the
  // stylist doesn't have to tick a service to discover the override.
  const availableServiceIds = useMemo(
    () => availableServices.map((s) => s.id),
    [availableServices],
  );
  const availableServiceIdsKey = useMemo(
    () => availableServiceIds.slice().sort().join(","),
    [availableServiceIds],
  );
  const clientIdForResolve = form.selectedClient?.id ?? null;
  useEffect(() => {
    if (!clientIdForResolve || availableServiceIds.length === 0) {
      setResolvedByService(new Map());
      return;
    }
    let cancelled = false;
    fetchMultiServiceDuration(
      availableServiceIds,
      clientIdForResolve,
      form.staffId,
    )
      .then((info) => {
        if (cancelled) return;
        setResolvedByService(
          new Map(info.services.map((s) => [s.serviceId, s])),
        );
      })
      .catch(() => {
        if (!cancelled) setResolvedByService(new Map());
      });
    return () => {
      cancelled = true;
    };
    // availableServiceIdsKey is a stable string snapshot of the id list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableServiceIdsKey, clientIdForResolve, form.staffId]);

  const updateExtra = (key: number, patch: Partial<ExtraPerson>) =>
    setExtras((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const addExtra = () => {
    setExtras((prev) => [
      ...prev,
      { key: nextKey, sameClient: true, client: null, staffId: null, serviceIds: [], starts: "same" },
    ]);
    setNextKey((k) => k + 1);
  };

  const extrasReady = extras.every(
    (p) => p.staffId && p.serviceIds.length > 0 && (p.sameClient || p.client),
  );

  async function handleGroupSubmit() {
    if (
      !form.staffId ||
      !form.selectedClient ||
      form.selectedServiceIds.length === 0 ||
      !form.startTime ||
      !extrasReady
    ) {
      toast.error("Please fill in all required fields");
      return;
    }
    const first = form.startTime;
    const firstEnd = new Date(first.getTime() + (form.durationInfo?.totalMinutes ?? 0) * 60_000);
    form.setSubmitting(true);
    const result = await createBookingGroup({
      payerClientId: form.selectedClient.id,
      members: [
        {
          staffId: form.staffId,
          clientId: form.selectedClient.id,
          serviceIds: form.selectedServiceIds,
          startTime: first.toISOString(),
          locationId: form.locationId,
        },
        ...extras.map((p) => ({
          staffId: p.staffId!,
          clientId: p.sameClient ? form.selectedClient!.id : p.client!.id,
          serviceIds: p.serviceIds,
          startTime: (p.starts === "after" ? firstEnd : first).toISOString(),
          locationId: null,
        })),
      ],
    });
    form.setSubmitting(false);
    if (result.success) {
      toast.success(t("bookingPanel.groupCreated"));
      onClose();
      onBookingCreated();
    } else {
      toast.error(result.error);
    }
  }

  async function handleSeriesSubmit() {
    if (
      !form.staffId ||
      !form.selectedClient ||
      form.selectedServiceIds.length === 0 ||
      !form.startTime ||
      repeat === "none"
    ) {
      toast.error("Please fill in all required fields");
      return;
    }
    form.setSubmitting(true);
    const result = await createRecurringBooking({
      staffId: form.staffId,
      clientId: form.selectedClient.id,
      serviceIds: form.selectedServiceIds,
      startTime: form.startTime.toISOString(),
      locationId: form.locationId,
      repeat,
      count: endsAfter,
    });
    form.setSubmitting(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(t("bookingPanel.seriesCreated", { created: result.createdCount }));
    onBookingCreated();
    if (result.conflicts.length === 0) {
      onClose();
      return;
    }
    setSeriesResult({
      created: result.createdCount,
      conflicts: result.conflicts.map((c) => format(new Date(c.start), "EEEE, MMMM d, h:mm a")),
    });
  }

  async function handleSubmit() {
    if (extras.length > 0) return handleGroupSubmit();
    if (repeat !== "none") return handleSeriesSubmit();
    if (
      !form.staffId ||
      !form.selectedClient ||
      form.selectedServiceIds.length === 0 ||
      !form.startTime
    ) {
      toast.error("Please fill in all required fields");
      return;
    }

    form.setSubmitting(true);

    const result = await createBooking({
      staffId: form.staffId,
      clientId: form.selectedClient.id,
      serviceIds: form.selectedServiceIds,
      startTime: form.startTime.toISOString(),
      locationId: form.locationId,
      // Stylist UI always allows overlapping appointments. Public booking UI
      // goes through confirmBooking, which does not set this flag.
      allowOverlap: true,
      ...(projectId ? { projectId } : {}),
    });

    form.setSubmitting(false);

    if (result.success) {
      toast.success("Booking created");
      if (projectId) {
        const url = new URL(window.location.href);
        url.searchParams.delete("projectId");
        url.searchParams.delete("client");
        router.replace(url.pathname + url.search);
      }
      onClose();
      onBookingCreated();
    } else {
      const errorMsg =
        "message" in result.error
          ? (result.error as { message: string }).message
          : "Failed to create booking";
      toast.error(errorMsg);
    }
  }

  const seriesSummary = seriesResult && (
    <div className="space-y-4 p-1">
      <p className="text-sm font-medium">
        {t("bookingPanel.seriesCreated", { created: seriesResult.created })}
      </p>
      <p className="text-sm">
        {t("bookingPanel.seriesConflicts", { count: seriesResult.conflicts.length })}
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {seriesResult.conflicts.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <Button onClick={onClose}>{t("bookingPanel.done")}</Button>
    </div>
  );

  const formContent = seriesSummary || (
    <div className="space-y-6 p-1">
      {/* Date & Time */}
      <div className="space-y-2">
        <Label>Date & Time</Label>
        <div className="grid grid-cols-2 gap-3">
          <Input
            type="date"
            value={dateValue}
            onChange={(e) => {
              const [year, month, day] = e.target.value.split("-").map(Number);
              const next = form.startTime ? new Date(form.startTime) : new Date();
              next.setFullYear(year, month - 1, day);
              form.setStartTime(next);
            }}
          />
          <Select
            value={timeValue}
            onValueChange={(val) => {
              const [h, m] = val.split(":").map(Number);
              const next = form.startTime ? new Date(form.startTime) : new Date();
              next.setHours(h, m, 0, 0);
              form.setStartTime(next);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Time" />
            </SelectTrigger>
            <SelectContent>
              {BOOKING_TIME_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Stylist */}
      <div className="space-y-2">
        <Label>{t("bookingPanel.staffLabel")}</Label>
        <Select
          value={form.staffId ?? ""}
          onValueChange={(v) => form.setStaffId(v)}
        >
          <SelectTrigger>
            <SelectValue placeholder={t("bookingPanel.staffPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {staff.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Location */}
      <div className="space-y-2">
        <Label>Location</Label>
        <Select
          value={form.locationId ?? ""}
          onValueChange={(value) => form.setLocationId(value)}
          disabled={!form.staffId || locations.length === 0}
        >
          <SelectTrigger>
            <SelectValue
              placeholder={
                form.staffId
                  ? locations.length === 0
                    ? "No locations configured"
                    : "Choose location"
                  : t("bookingPanel.chooseStaffFirst")
              }
            />
          </SelectTrigger>
          <SelectContent>
            {locations.map((location) => (
              <SelectItem key={location.id} value={location.id}>
                {location.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Client */}
      <div className="space-y-2">
        <Label>Client</Label>
        <ClientSearch
          selectedClient={form.selectedClient}
          onSelect={form.setClient}
        />
      </div>

      {projectId && (
        <p role="status" className="text-sm font-medium">
          {t("bookingPanel.forProject")}
        </p>
      )}

      {/* Services */}
      <div className="space-y-2">
        <Label>Services</Label>
        <ServiceSelector
          services={availableServices}
          selectedServiceIds={form.selectedServiceIds}
          onToggle={form.toggleService}
          durationInfo={form.durationInfo}
          resolvedByService={resolvedByService}
          hasClient={form.selectedClient !== null}
        />
      </div>

      {/* Repeat (not for group bookings) */}
      {extras.length === 0 && (
        <div className="space-y-2">
          <Label>{t("bookingPanel.repeat")}</Label>
          <Select value={repeat} onValueChange={(v) => setRepeat(v as "none" | "weekly" | "biweekly")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("bookingPanel.repeatNone")}</SelectItem>
              <SelectItem value="weekly">{t("bookingPanel.repeatWeekly")}</SelectItem>
              <SelectItem value="biweekly">{t("bookingPanel.repeatBiweekly")}</SelectItem>
            </SelectContent>
          </Select>
          {repeat !== "none" && (
            <div className="space-y-2">
              <Label>{t("bookingPanel.ends")}</Label>
              <Select
                value={endsAfter == null ? "never" : String(endsAfter)}
                onValueChange={(v) => setEndsAfter(v === "never" ? null : Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="never">{t("bookingPanel.endsNever")}</SelectItem>
                  {Array.from({ length: 25 }, (_, i) => i + 2).map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {t("bookingPanel.endsAfter", { count: n })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}

      {/* More people (group booking) */}
      {extras.map((person, i) => {
        const personServices = person.staffId
          ? (liveStaffServices.get(person.staffId) ??
            staff.find((s) => s.id === person.staffId)?.services ??
            [])
          : [];
        const offered = allServices.filter((svc) =>
          personServices.some((ss) => ss.serviceId === svc.id),
        );
        return (
          <div key={person.key} className="space-y-3 border border-[var(--line)] p-3">
            <div className="flex items-center justify-between">
              <Label>{t("bookingPanel.personN", { n: i + 2 })}</Label>
              <Button
                type="button"
                variant="outline"
                
                onClick={() => setExtras((prev) => prev.filter((p) => p.key !== person.key))}
              >
                {t("bookingPanel.removePerson")}
              </Button>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                
                variant={person.sameClient ? "default" : "outline"}
                onClick={() => updateExtra(person.key, { sameClient: true, client: null })}
              >
                {t("bookingPanel.sameClient")}
              </Button>
              <Button
                type="button"
                
                variant={person.sameClient ? "outline" : "default"}
                onClick={() => updateExtra(person.key, { sameClient: false })}
              >
                {t("bookingPanel.differentClient")}
              </Button>
            </div>
            {!person.sameClient && (
              <ClientSearch
                selectedClient={person.client}
                onSelect={(c) => updateExtra(person.key, { client: c })}
              />
            )}
            <Select
              value={person.staffId ?? ""}
              onValueChange={(v) => updateExtra(person.key, { staffId: v, serviceIds: [] })}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("bookingPanel.staffPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {staff.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {person.staffId && (
              <div className="space-y-1">
                {offered.map((svc) => {
                  const checked = person.serviceIds.includes(svc.id);
                  return (
                    <label key={svc.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) =>
                          updateExtra(person.key, {
                            serviceIds: v === true
                              ? [...person.serviceIds, svc.id]
                              : person.serviceIds.filter((id) => id !== svc.id),
                          })
                        }
                      />
                      {svc.name} ({svc.defaultDurationMinutes} min)
                    </label>
                  );
                })}
              </div>
            )}
            <div className="space-y-1">
              <Label>{t("bookingPanel.startsWhen")}</Label>
              <Select
                value={person.starts}
                onValueChange={(v) => updateExtra(person.key, { starts: v as "same" | "after" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="same">{t("bookingPanel.sameTime")}</SelectItem>
                  <SelectItem value="after">{t("bookingPanel.rightAfter")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        );
      })}
      {extras.length < 7 && (
        <Button type="button" variant="outline" onClick={addExtra}>
          {t("bookingPanel.addPerson")}
        </Button>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <Button
          className="flex-1"
          onClick={handleSubmit}
          disabled={
            form.isSubmitting ||
            !form.staffId ||
            !form.selectedClient ||
            form.selectedServiceIds.length === 0 ||
            !extrasReady
          }
        >
          {form.isSubmitting ? "Creating..." : "Create Booking"}
        </Button>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Booking</DialogTitle>
          </DialogHeader>
          {formContent}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="flex w-full max-w-md flex-col overflow-y-auto px-4 sm:max-w-lg sm:px-6">
        <SheetHeader>
          <SheetTitle>New Booking</SheetTitle>
        </SheetHeader>
        {formContent}
      </SheetContent>
    </Sheet>
  );
}
