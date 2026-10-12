"use client";

import { useT } from "@/lib/terms/client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { format, parseISO } from "date-fns";
import { TZDate } from "@date-fns/tz";
import { getAvailableDates, getAvailableSlots, saveClientAddressPublic } from "@/actions/booking-public";
import { getStaffLocations } from "@/actions/locations";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { WaitlistJoin } from "@/components/booking-public/waitlist-join";
import { MapPinIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface DateEntry {
  date: string;
  hasSlots: boolean;
}

interface SlotEntry {
  time: string;
  isDoubleBook: boolean;
  doubleBookParentAppointmentId: string | null;
  staffId?: string;
  staffName?: string | null;
}

interface LocationChoice {
  id: string;
  name: string;
  address: string | null;
}

interface TimeStepProps {
  staffId: string;
  locationId: string | null;
  serviceAddressId?: string | null;
  needsAddress?: boolean | null;
  clientId?: string | null;
  serviceIds: string[];
  salonTimezone: string;
  onComplete: (
    date: string,
    time: string,
    isDoubleBook?: boolean,
    doubleBookParentAppointmentId?: string | null,
    assignedStaffId?: string,
    assignedStaffName?: string | null,
  ) => void;
  onLocation?: (locationId: string | null, locationName: string, locationAddress?: string | null) => void;
  onAddress?: (addressId: string) => void;
  selectedDate: string | null;
  selectedTime: string | null;
  waitlistEnabled?: boolean;
  clientPhone?: string | null;
  prefillLocationId?: string | null;
  timeNotice?: string | null;
  sampleSchedule?: {
    dates: DateEntry[];
    slots: SlotEntry[];
  };
}

const NO_SLOTS: SlotEntry[] = [];

const ADDRESS_FIELDS = ["line1", "line2", "city", "region", "postalCode"] as const;
type AddressField = (typeof ADDRESS_FIELDS)[number];

function slotPart(iso: string, timeZone: string): "morning" | "afternoon" {
  const hours = new TZDate(new Date(iso), timeZone).getHours();
  return hours < 12 ? "morning" : "afternoon";
}

export function TimeStep({
  staffId,
  locationId,
  serviceAddressId,
  needsAddress = false,
  clientId,
  serviceIds,
  salonTimezone,
  onComplete,
  onLocation = () => {},
  onAddress = () => {},
  selectedDate,
  selectedTime,
  waitlistEnabled = false,
  clientPhone = null,
  prefillLocationId,
  timeNotice,
  sampleSchedule,
}: TimeStepProps) {
  const t = useT("booking");
  const tf = useT("requests");
  const sample = sampleSchedule != null;
  const serviceKey = serviceIds.join(",");
  const [locations, setLocations] = useState<LocationChoice[]>([]);
  const [locationsReady, setLocationsReady] = useState(sample);
  const [dates, setDates] = useState<DateEntry[]>(sampleSchedule?.dates ?? []);
  const [loadingDates, setLoadingDates] = useState(!sample);
  const [activeDate, setActiveDate] = useState<string | null>(sampleSchedule?.dates[0]?.date ?? selectedDate);
  const [fetchedSlots, setFetchedSlots] = useState<{ query: string; slots: SlotEntry[] } | null>(null);
  const [activeTime, setActiveTime] = useState<string | null>(selectedTime);
  const [, startTransition] = useTransition();
  const onLocationRef = useRef(onLocation);
  onLocationRef.current = onLocation;
  const locationIdRef = useRef(locationId);
  locationIdRef.current = locationId;

  const [address, setAddress] = useState<Record<AddressField, string>>({
    line1: "",
    line2: "",
    city: "",
    region: "",
    postalCode: "",
  });
  const [missing, setMissing] = useState<Set<AddressField>>(new Set());
  const [addressError, setAddressError] = useState<string | null>(null);
  const [savingAddress, setSavingAddress] = useState(false);

  useEffect(() => {
    if (sample) return;
    let cancelled = false;
    startTransition(() => {
      void (async () => {
        try {
          const data = await getStaffLocations(staffId);
          if (cancelled) return;
          setLocations(data);
          const prefilled = prefillLocationId ? data.find((location) => location.id === prefillLocationId) : undefined;
          const only = data.length === 1 ? data[0] : undefined;
          const chosen = prefilled ?? only;
          if (data.length <= 1 || prefilled) {
            const nextId = chosen?.id ?? null;
            if (nextId !== locationIdRef.current) {
              onLocationRef.current(nextId, chosen?.name ?? "", chosen?.address ?? null);
            }
          }
        } catch (err) {
          if (err instanceof Error && err.name === "AuthError") throw err;
          if (!cancelled) setLocations([]);
        } finally {
          if (!cancelled) setLocationsReady(true);
        }
      })();
    });
    return () => {
      cancelled = true;
    };
  }, [prefillLocationId, sample, staffId]);

  const addressBlocked = !sample && needsAddress === true && !serviceAddressId;
  const waitingOnAddress = !sample && needsAddress === null;
  const locationBlocked = !sample && locations.length > 1 && !locationId;
  const canLoadTimes = sample || (locationsReady && !addressBlocked && !waitingOnAddress && !locationBlocked);
  const slotQuery = activeDate
    ? [activeDate, staffId, serviceKey, locationId, clientId, serviceAddressId].join("|")
    : null;
  // null while the times for the current day and choices have not arrived yet.
  const slots: SlotEntry[] | null =
    sampleSchedule?.slots ??
    (slotQuery === null ? NO_SLOTS : fetchedSlots?.query === slotQuery ? fetchedSlots.slots : null);

  useEffect(() => {
    if (!canLoadTimes || sample) return;
    let cancelled = false;
    startTransition(() => {
      void (async () => {
        setLoadingDates(true);
        try {
          const data = await getAvailableDates({
            staffId,
            serviceIds: serviceKey.split(",").filter(Boolean),
            locationId,
            clientId: clientId ?? null,
            serviceAddressId: serviceAddressId ?? null,
          });
          if (cancelled) return;
          setDates(data);
          if (selectedDate && data.some((entry) => entry.date === selectedDate)) {
            setActiveDate(selectedDate);
          } else if (data.length > 0) {
            setActiveDate(data[0].date);
          }
        } catch (err) {
          if (err instanceof Error && err.name === "AuthError") throw err;
        } finally {
          if (!cancelled) setLoadingDates(false);
        }
      })();
    });
    return () => {
      cancelled = true;
    };
  }, [canLoadTimes, clientId, locationId, sample, selectedDate, serviceAddressId, serviceKey, staffId]);

  useEffect(() => {
    if (sample || !canLoadTimes || !activeDate || !slotQuery) return;
    let cancelled = false;
    startTransition(() => {
      void (async () => {
        try {
          const data = await getAvailableSlots({
            staffId,
            serviceIds: serviceKey.split(",").filter(Boolean),
            locationId,
            clientId: clientId ?? null,
            serviceAddressId: serviceAddressId ?? null,
            date: activeDate,
          });
          if (cancelled) return;
          setFetchedSlots({ query: slotQuery, slots: data });
          if (selectedDate === activeDate && selectedTime && data.some((slot) => slot.time === selectedTime)) {
            setActiveTime(selectedTime);
          }
        } catch (err) {
          if (err instanceof Error && err.name === "AuthError") throw err;
          if (!cancelled) setFetchedSlots({ query: slotQuery, slots: [] });
        }
      })();
    });
    return () => {
      cancelled = true;
    };
  }, [
    activeDate,
    canLoadTimes,
    clientId,
    locationId,
    sample,
    selectedDate,
    selectedTime,
    serviceAddressId,
    serviceKey,
    slotQuery,
    staffId,
  ]);

  const enabled = useMemo(() => new Set(dates.filter((entry) => entry.hasSlots).map((entry) => entry.date)), [dates]);

  const grouped = useMemo(() => {
    const list = slots ?? NO_SLOTS;
    const morning = list.filter((slot) => slotPart(slot.time, salonTimezone) === "morning");
    const afternoon = list.filter((slot) => slotPart(slot.time, salonTimezone) === "afternoon");
    return [
      { part: "morning" as const, items: morning },
      { part: "afternoon" as const, items: afternoon },
    ];
  }, [salonTimezone, slots]);

  function formatSlotTime(isoString: string): string {
    return format(new TZDate(new Date(isoString), salonTimezone), "h:mm a");
  }

  async function saveAddress() {
    const empty = new Set(ADDRESS_FIELDS.filter((field) => field !== "line2" && address[field].trim() === ""));
    setMissing(empty);
    setAddressError(null);
    if (empty.size > 0) return;
    setSavingAddress(true);
    try {
      const res = await saveClientAddressPublic(address);
      if (res.success) onAddress(res.addressId);
      else setAddressError(res.error);
    } catch (err) {
      if (err instanceof Error && err.name === "AuthError") throw err;
      setAddressError(t("addressStep.notFound"));
    } finally {
      setSavingAddress(false);
    }
  }

  const waitlist =
    waitlistEnabled && locationId ? (
      <WaitlistJoin
        serviceIds={serviceIds}
        staffId={staffId}
        locationId={locationId}
        activeDate={activeDate}
        salonTimezone={salonTimezone}
        clientPhone={clientPhone}
      />
    ) : null;

  if (addressBlocked) {
    return (
      <div className="space-y-4">
        <h2 className="display text-3xl text-[var(--ink)]">{t("addressStep.title")}</h2>
        <div className="space-y-3">
          {ADDRESS_FIELDS.map((field) => (
            <div key={field} className="space-y-1">
              <Label htmlFor={`address-${field}`}>{tf(`fields.address.${field}`)}</Label>
              <Input
                id={`address-${field}`}
                className="min-h-11"
                value={address[field]}
                aria-invalid={missing.has(field)}
                onChange={(event) => setAddress((prev) => ({ ...prev, [field]: event.target.value }))}
              />
              {missing.has(field) && (
                <p role="alert" className="text-sm text-destructive">
                  {tf("required")}
                </p>
              )}
            </div>
          ))}
        </div>
        {addressError && (
          <p role="alert" className="text-sm text-destructive">
            {addressError}
          </p>
        )}
        <Button type="button" variant="default" className="w-full" disabled={savingAddress} onClick={saveAddress}>
          {savingAddress ? t("addressStep.saving") : t("addressStep.continue")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="display text-3xl text-[var(--ink)]">{t("timeStep.title")}</h2>
      {timeNotice && (
        <p role="alert" className="border border-[var(--line)] bg-[var(--ivory-raised)] px-4 py-3 text-sm text-[var(--ink)]">
          {timeNotice}
        </p>
      )}

      {locations.length > 1 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-[var(--ink)]">{t("timeStep.locationTitle")}</h3>
          {locations.map((location) => {
            const isSelected = locationId === location.id;
            return (
              <button
                key={location.id}
                type="button"
                onClick={() => onLocation(location.id, location.name, location.address)}
                aria-pressed={isSelected}
                className={cn(
                  "flex min-h-11 w-full items-start gap-3 border border-[var(--line)] p-4 text-left",
                  isSelected && "border-[var(--ink)] bg-[var(--ivory-raised)]",
                )}
              >
                <MapPinIcon className="mt-0.5 size-4 shrink-0 text-[var(--ink-soft)]" />
                <span className="min-w-0">
                  <span className="block text-base text-[var(--ink)]">{location.name}</span>
                  {location.address && (
                    <span className="mt-1 block text-sm text-[var(--ink-soft)]">{location.address}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {(loadingDates || waitingOnAddress || !locationsReady) && !sample ? (
        <Skeleton className="h-64 w-full" />
      ) : locationBlocked ? null : (
        <>
          <Calendar
            mode="single"
            showOutsideDays={false}
            selected={activeDate ? parseISO(activeDate) : undefined}
            defaultMonth={dates[0] ? parseISO(dates[0].date) : undefined}
            onDayClick={(day) => {
              const key = format(day, "yyyy-MM-dd");
              if (!enabled.has(key)) return;
              setActiveDate(key);
              setActiveTime(null);
            }}
            disabled={(day) => !enabled.has(format(day, "yyyy-MM-dd"))}
            components={{
              DayButton: (props) => {
                const key = format(props.day.date, "yyyy-MM-dd");
                return (
                  <CalendarDayButton
                    {...props}
                    className="[&>span]:text-[13px]"
                    {...(enabled.has(key) ? { "data-booking-date": key } : {})}
                  />
                );
              },
            }}
            className="p-0 [--cell-size:--spacing(11)]"
            classNames={{
              weekday: "text-muted-foreground flex-1 rounded-md text-[13px] font-normal select-none",
            }}
          />

          {slots === null ? (
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-14 rounded-md" />
              ))}
            </div>
          ) : slots.length === 0 && activeDate ? (
            <p className="text-sm text-[var(--ink-soft)]">{t("timeStep.noTimes")}</p>
          ) : (
            grouped.map(
              ({ part, items }) =>
                items.length > 0 && (
                  <div key={part} className="space-y-2">
                    <h3 className="text-[13px] font-medium uppercase tracking-wide text-[var(--ink-soft)]">
                      {t(`timeStep.${part}`)}
                    </h3>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {items.map((slot) => {
                        const isSelected = activeTime === slot.time;
                        const label = slot.isDoubleBook
                          ? `${formatSlotTime(slot.time)}, flex`
                          : formatSlotTime(slot.time);
                        return (
                          <button
                            key={`${slot.time}-${slot.staffId ?? ""}`}
                            type="button"
                            aria-label={label}
                            aria-pressed={isSelected}
                            data-slot-double-book={slot.isDoubleBook ? "true" : "false"}
                            onClick={() => setActiveTime(slot.time)}
                            className={cn(
                              "flex min-h-14 flex-col items-center justify-center border-2 border-[var(--line)] px-3 py-2 text-sm font-medium",
                              isSelected && "border-[var(--ink)] bg-[var(--ink)] text-[var(--ivory)]",
                            )}
                          >
                            <span>{formatSlotTime(slot.time)}</span>
                            {slot.isDoubleBook && (
                              <span className={cn("text-[13px]", isSelected ? "text-[var(--ivory)]" : "text-[var(--ink-soft)]")}>
                                (flex)
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ),
            )
          )}
        </>
      )}

      {waitlist}

      <div className="sticky bottom-[var(--app-tab-bar-offset,0px)] z-20 -mx-4 border-t border-[var(--line)] bg-[var(--ivory)] px-4 pb-[var(--app-footer-safe-pad,env(safe-area-inset-bottom))] pt-3 sm:static sm:-mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
        <Button
          onClick={() => {
            if (!activeDate || !activeTime) return;
            const selectedSlot = slots?.find((slot) => slot.time === activeTime);
            onComplete(
              activeDate,
              activeTime,
              selectedSlot?.isDoubleBook,
              selectedSlot?.doubleBookParentAppointmentId ?? null,
              selectedSlot?.staffId,
              selectedSlot?.staffName,
            );
          }}
          disabled={!activeDate || !activeTime}
          className="w-full"
          variant="default"
        >
          {t("timeStep.continue")}
        </Button>
      </div>
    </div>
  );
}
