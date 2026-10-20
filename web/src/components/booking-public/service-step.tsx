"use client";

import { useT } from "@/lib/terms/client";
import { useState, useEffect, useMemo, useTransition } from "react";
import {
  getBookingStaff,
  getStaffServices,
  getRecentClientServices,
} from "@/actions/booking-public";
import { getAddonsForServices, type AddonOption } from "@/actions/service-addons";
import { listServiceCategories } from "@/actions/service-categories";
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
} from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckIcon, ClockIcon, HistoryIcon, PlusIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface StaffMember {
  id: string;
  displayName: string;
  photoUrl: string | null;
  bio: string | null;
  services: { serviceId: string; serviceName: string }[];
}

interface Service {
  serviceId: string;
  serviceName: string;
  durationMinutes: number;
  priceCents?: number;
  category?: string;
  priceDisplay?: string;
}

interface CategoryMeta {
  slug: string;
  name: string;
}

interface ServiceStepProps {
  businessId: string;
  clientId: string | null;
  selectedStaffId: string | null;
  selectedServiceIds: string[];
  onComplete: (
    staffId: string,
    staffName: string,
    serviceIds: string[],
    serviceSummary: string,
    totalDuration: number,
  ) => void;
  sampleServices?: Service[];
  initialStaff?: StaffMember[];
}

/** The `staffId` of the "Anyone available" choice. */
export const ANY_STAFF_ID = "any";

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

const formatCents = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);

function priceLabel(priceCents: number | undefined, priceDisplay: string | undefined): string | null {
  if (priceCents == null || priceCents <= 0) return null;
  if (priceDisplay === "hidden") return null;
  if (priceDisplay === "starting") return `From ${formatCents(priceCents)}`;
  return formatCents(priceCents);
}

export function ServiceStep({
  businessId,
  clientId,
  selectedStaffId,
  selectedServiceIds,
  onComplete,
  sampleServices,
  initialStaff,
}: ServiceStepProps) {
  const t = useT("booking");
  const sample = sampleServices != null;
  const [staff, setStaff] = useState<StaffMember[]>(initialStaff ?? []);
  const [loadingStaff, setLoadingStaff] = useState(!sample && !initialStaff);
  const [selectedId, setSelectedId] = useState<string>(selectedStaffId ?? ANY_STAFF_ID);
  const [services, setServices] = useState<Service[]>(sampleServices ?? []);
  const [recent, setRecent] = useState<{ serviceIds: string[]; visitDate: string | null } | null>(null);
  const [hiddenForNewClient, setHiddenForNewClient] = useState(false);
  const [categories, setCategories] = useState<CategoryMeta[]>([]);
  const [addonsByPrimary, setAddonsByPrimary] = useState<Record<string, AddonOption[]>>({});
  const [loadingServices, setLoadingServices] = useState(!sample);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set(selectedServiceIds));
  const [checkedAddonIds, setCheckedAddonIds] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (sample) return;
    let cancelled = false;
    startTransition(() => {
      void (async () => {
        setLoadingStaff(true);
        try {
          const data = await getBookingStaff();
          if (!cancelled) setStaff(data);
        } catch (err) {
          if (err instanceof Error && err.name === "AuthError") throw err;
        } finally {
          if (!cancelled) setLoadingStaff(false);
        }
      })();
    });
    return () => {
      cancelled = true;
    };
  }, [sample, businessId]);

  useEffect(() => {
    if (sample) return;
    let cancelled = false;
    startTransition(() => {
      void (async () => {
        setLoadingServices(true);
        try {
          const [data, cats, recentVisit] = await Promise.all([
            getStaffServices(selectedId, clientId),
            listServiceCategories().catch((err: unknown) => {
              if (err instanceof Error && err.name === "AuthError") throw err;
              return [];
            }),
            clientId
              ? getRecentClientServices(clientId, selectedId).catch((err: unknown) => {
                  if (err instanceof Error && err.name === "AuthError") throw err;
                  return null;
                })
              : Promise.resolve(null),
          ]);
          if (cancelled) return;
          setServices(data.services);
          setRecent(recentVisit?.serviceIds.length ? recentVisit : null);
          setHiddenForNewClient(data.hiddenForNewClient);
          setCategories(cats.map((c) => ({ slug: c.slug, name: c.name })));
          const ids = data.services.map((s) => s.serviceId);
          const addons =
            ids.length > 0
              ? await getAddonsForServices(ids, clientId, selectedId === ANY_STAFF_ID ? null : selectedId).catch(
                  (err: unknown) => {
                    if (err instanceof Error && err.name === "AuthError") throw err;
                    return {};
                  },
                )
              : {};
          if (!cancelled) setAddonsByPrimary(addons);
        } finally {
          if (!cancelled) setLoadingServices(false);
        }
      })();
    });
    return () => {
      cancelled = true;
    };
  }, [sample, selectedId, clientId]);

  const visibleAddons = useMemo(() => {
    const map = new Map<string, AddonOption>();
    for (const id of checkedIds) {
      for (const addon of addonsByPrimary[id] ?? []) {
        if (!checkedIds.has(addon.serviceId)) map.set(addon.serviceId, addon);
      }
    }
    return map;
  }, [checkedIds, addonsByPrimary]);

  const effectiveAddonIds = useMemo(
    () => new Set([...checkedAddonIds].filter((id) => visibleAddons.has(id))),
    [checkedAddonIds, visibleAddons],
  );

  const { totalDuration, serviceSummary, totalCents } = useMemo(() => {
    const selected = services.filter((s) => checkedIds.has(s.serviceId));
    let duration = selected.reduce((sum, s) => sum + s.durationMinutes, 0);
    let cents = selected.reduce((sum, s) => sum + (s.priceCents ?? 0), 0);
    for (const id of effectiveAddonIds) {
      const addon = visibleAddons.get(id);
      if (addon) {
        duration += addon.durationMinutes;
        cents += addon.priceCents ?? 0;
      }
    }
    const names = [
      ...selected.map((s) => s.serviceName),
      ...[...effectiveAddonIds].map((id) => visibleAddons.get(id)?.serviceName ?? ""),
    ].filter(Boolean);
    return {
      totalDuration: duration,
      serviceSummary: names.join(" + "),
      totalCents: cents,
    };
  }, [services, checkedIds, effectiveAddonIds, visibleAddons]);

  const grouped = useMemo(() => {
    const order = new Map(categories.map((c, i) => [c.slug, i]));
    const nameBySlug = new Map(categories.map((c) => [c.slug, c.name]));
    const buckets = new Map<string, Service[]>();
    for (const service of services) {
      const slug = service.category ?? "other";
      (buckets.get(slug) ?? buckets.set(slug, []).get(slug)!).push(service);
    }
    return Array.from(buckets.entries())
      .sort((a, b) => {
        const ai = order.has(a[0]) ? order.get(a[0])! : Number.MAX_SAFE_INTEGER;
        const bi = order.has(b[0]) ? order.get(b[0])! : Number.MAX_SAFE_INTEGER;
        return ai - bi;
      })
      .map(([slug, items]) => ({
        slug,
        name: nameBySlug.get(slug) ?? slug,
        items,
      }));
  }, [services, categories]);

  const recentServices = useMemo(() => {
    if (!recent) return [];
    const ids = new Set(recent.serviceIds);
    return services.filter((s) => ids.has(s.serviceId));
  }, [recent, services]);

  const allRecentSelected =
    recentServices.length > 0 && recentServices.every((s) => checkedIds.has(s.serviceId));

  const lastVisitLabel = useMemo(() => {
    if (!recent?.visitDate) return null;
    const d = new Date(recent.visitDate);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return format(d, sameYear ? "MMM d" : "MMM d, yyyy");
  }, [recent]);

  const totalSelected = checkedIds.size + effectiveAddonIds.size;
  const showCategoryHeaders = grouped.length > 1;

  const handleContinue = () => {
    if (selectedId === ANY_STAFF_ID) {
      onComplete(ANY_STAFF_ID, t("staffStep.anyTitle"), [...checkedIds, ...effectiveAddonIds], serviceSummary, totalDuration);
      return;
    }
    const person = staff.find((member) => member.id === selectedId);
    if (!person) return;
    onComplete(person.id, person.displayName, [...checkedIds, ...effectiveAddonIds], serviceSummary, totalDuration);
  };

  if (loadingStaff) {
    return (
      <div className="space-y-4">
        <h2 className="display text-3xl text-[var(--ink)]">{t("staffStep.title")}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-3 border border-[var(--line)] p-4">
              <Skeleton className="size-16 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const renderServiceRow = (service: Service) => {
    const isChecked = checkedIds.has(service.serviceId);
    const price = priceLabel(service.priceCents, service.priceDisplay);
    const addons = isChecked ? addonsByPrimary[service.serviceId] ?? [] : [];
    return (
      <div key={service.serviceId} className="space-y-1">
        <label
          style={{ borderColor: isChecked ? "var(--accent)" : "var(--line)" }}
          className={cn(
            "flex min-h-11 cursor-pointer items-center gap-3 border border-[var(--line)] px-4 py-3.5 transition-colors hover:bg-[var(--ivory-raised)]",
            isChecked && "bg-accent/10",
          )}
        >
          <Checkbox
            checked={isChecked}
            onCheckedChange={() =>
              setCheckedIds((prev) => {
                const next = new Set(prev);
                if (next.has(service.serviceId)) next.delete(service.serviceId);
                else next.add(service.serviceId);
                return next;
              })
            }
          />
          <span className="flex-1 text-sm font-light text-[var(--ink)]">{service.serviceName}</span>
          <span className="flex shrink-0 items-center gap-2">
            {price && <span className="text-sm font-medium text-[var(--ink)]">{price}</span>}
            <Badge variant="default" className="gap-1 text-[13px]">
              <ClockIcon className="size-3" />
              {service.durationMinutes} min
            </Badge>
          </span>
        </label>
        {addons.length > 0 && (
          <div className="ml-6 space-y-1 border-l border-[var(--line)] pb-3 pl-3">
            <p className="flex items-center gap-1 pt-1 text-[13px] uppercase tracking-wide text-[var(--ink-soft)]">
              <PlusIcon className="size-3" /> {t("serviceStep.addons")}
            </p>
            {addons.map((addon) => {
              const addonPrice = priceLabel(addon.priceCents, addon.priceDisplay);
              const addonChecked = effectiveAddonIds.has(addon.serviceId) || checkedIds.has(addon.serviceId);
              const alsoPrimary = checkedIds.has(addon.serviceId);
              return (
                <label
                  key={addon.serviceId}
                  className={cn(
                    "flex min-h-11 items-center gap-3 border border-[var(--line)] p-3 text-sm",
                    alsoPrimary ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-[var(--ivory-raised)]",
                    addonChecked && "border-accent bg-accent/10",
                  )}
                >
                  <Checkbox
                    checked={addonChecked}
                    disabled={alsoPrimary}
                    onCheckedChange={() =>
                      setCheckedAddonIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(addon.serviceId)) next.delete(addon.serviceId);
                        else next.add(addon.serviceId);
                        return next;
                      })
                    }
                  />
                  <span className="flex-1 font-light text-[var(--ink)]">
                    {addon.serviceName}
                    {alsoPrimary && (
                      <span className="ml-1 text-[13px] text-[var(--ink-soft)]">
                        {t("serviceStep.alreadySelected")}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {addonPrice && <span className="font-medium text-[var(--ink)]">{addonPrice}</span>}
                    <Badge variant="default" className="gap-1 text-[13px]">
                      <ClockIcon className="size-3" />
                      {addon.durationMinutes} min
                    </Badge>
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-32 sm:pb-0">
      <h2 className="display text-3xl text-[var(--ink)]">{t("serviceStep.title")}</h2>

      <div className="space-y-3">
        <h3 className="text-sm font-medium text-[var(--ink)]">{t("staffStep.title")}</h3>
        {staff.length === 0 ? (
          <p className="text-sm text-[var(--ink-soft)]">{t("staffStep.empty")}</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setSelectedId(ANY_STAFF_ID)}
              aria-pressed={selectedId === ANY_STAFF_ID}
              className={cn(
                "flex min-h-11 flex-col justify-center gap-1 border border-[var(--line)] p-4 text-left transition-all",
                selectedId === ANY_STAFF_ID
                  ? "border-accent bg-accent text-accent-foreground shadow-sm"
                  : "hover:border-[var(--ink)] hover:bg-[var(--ivory-raised)]",
              )}
            >
              <p className={cn("text-base font-medium", selectedId === ANY_STAFF_ID ? "text-accent-foreground" : "text-[var(--ink)]")}>
                {t("staffStep.anyTitle")}
              </p>
              <p className={cn("text-sm", selectedId === ANY_STAFF_ID ? "text-accent-foreground" : "text-[var(--ink-soft)]")}>
                {t("staffStep.anyBody")}
              </p>
            </button>
            {staff.map((member) => {
              const isSelected = selectedId === member.id;
              return (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => setSelectedId(member.id)}
                  aria-pressed={isSelected}
                  className={cn(
                    "flex min-h-11 gap-3 border border-[var(--line)] p-4 text-left transition-all",
                    isSelected
                      ? "border-accent bg-accent text-accent-foreground shadow-sm"
                      : "hover:border-[var(--ink)] hover:bg-[var(--ivory-raised)]",
                  )}
                >
                  <Avatar className="size-16 shrink-0 text-lg">
                    {member.photoUrl ? <AvatarImage src={member.photoUrl} alt={member.displayName} /> : null}
                    <AvatarFallback className="text-sm">{getInitials(member.displayName)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-base font-medium", isSelected ? "text-accent-foreground" : "text-[var(--ink)]")}>
                      {member.displayName}
                    </p>
                    {member.bio && (
                      <p className={cn("mt-0.5 line-clamp-2 text-sm", isSelected ? "text-accent-foreground" : "text-[var(--ink-soft)]")}>
                        {member.bio}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {loadingServices ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : services.length === 0 ? (
        <div className="border border-[var(--line)] bg-[var(--ivory-raised)] p-8 text-center">
          <p className="text-sm text-[var(--ink-soft)]">
            {hiddenForNewClient ? t("servicesStep.consultationOnly") : t("servicesStep.noServices")}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {hiddenForNewClient && (
            <p className="border border-[var(--line)] bg-[var(--ivory-raised)] px-4 py-3 text-sm text-[var(--ink-soft)]">
              {t("servicesStep.returningOnly")}
            </p>
          )}
          {recentServices.length > 0 && (
            <div className="space-y-2 border border-[var(--ink)] bg-[var(--ivory-raised)] p-4">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wide text-[var(--ink-soft)]">
                <HistoryIcon className="size-3.5" />
                {t("serviceStep.bookAgain")}
                {lastVisitLabel && (
                  <span className="font-normal normal-case tracking-normal">
                    {t("serviceStep.lastVisit", { date: lastVisitLabel })}
                  </span>
                )}
              </p>
              <p className="text-sm font-light text-[var(--ink)]">
                {recentServices.map((s) => s.serviceName).join(" + ")}
              </p>
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() =>
                  setCheckedIds((prev) => {
                    const next = new Set(prev);
                    for (const service of recentServices) next.add(service.serviceId);
                    return next;
                  })
                }
                disabled={allRecentSelected}
              >
                {allRecentSelected ? (
                  <>
                    <CheckIcon className="size-3.5" /> {t("serviceStep.selected")}
                  </>
                ) : (
                  t("serviceStep.selectRecent")
                )}
              </Button>
            </div>
          )}
          {grouped.map((group) => (
            <div key={group.slug} className="space-y-2">
              {showCategoryHeaders && (
                <p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--ink-soft)]">{group.name}</p>
              )}
              <div className="divide-y divide-[var(--line)] border border-[var(--line)]">
                {group.items.map(renderServiceRow)}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="sticky bottom-[var(--app-tab-bar-offset,0px)] z-20 -mx-4 space-y-3 border-t border-[var(--line)] bg-[var(--ivory)] px-4 pb-[var(--app-footer-safe-pad,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_16px_-12px_rgba(0,0,0,0.15)] sm:static sm:z-auto sm:-mx-0 sm:bg-transparent sm:px-0 sm:pt-4 sm:shadow-none">
        <div className="flex items-center justify-between text-sm">
          <span className="text-[var(--ink-soft)]">
            {totalSelected === 1
              ? t("serviceStep.selectedOne", { count: totalSelected })
              : t("serviceStep.selectedMany", { count: totalSelected })}
          </span>
          <span className="font-medium text-[var(--ink)]">
            {totalCents > 0 ? `${formatCents(totalCents)} · ${totalDuration} min` : `${totalDuration} min`}
          </span>
        </div>
        <Button
          onClick={handleContinue}
          disabled={totalSelected === 0 || (selectedId !== ANY_STAFF_ID && !staff.some((member) => member.id === selectedId))}
          className="w-full"
          variant="default"
        >
          {t("serviceStep.continue")}
        </Button>
      </div>
    </div>
  );
}
