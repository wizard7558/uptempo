"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { DurationBadge } from "./duration-badge";
import type { ServiceDurationInfo } from "@/lib/services/duration";

interface Service {
  id: string;
  name: string;
  defaultDurationMinutes: number;
  category?: string | null;
  description?: string | null;
}

interface ServiceSelectorProps {
  services: Service[];
  selectedServiceIds: string[];
  onToggle: (serviceId: string) => void;
  durationInfo: {
    services: ServiceDurationInfo[];
    totalMinutes: number;
  } | null;
  /** Resolved duration + price for EVERY service in the list (not just the
   * selected ones), so rows can show the client's custom values up front. */
  resolvedByService?: Map<string, ServiceDurationInfo>;
  hasClient: boolean;
}

function formatPrice(cents: number): string {
  if (cents % 100 === 0) return `$${Math.round(cents / 100)}`;
  return `$${(cents / 100).toFixed(2)}`;
}

function ServiceRow({
  service,
  isSelected,
  duration,
  isOverride,
  priceCents,
  isPriceOverride,
  hasClient,
  onToggle,
}: {
  service: Service;
  isSelected: boolean;
  duration: number;
  isOverride: boolean;
  priceCents: number | null;
  isPriceOverride: boolean;
  hasClient: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex cursor-pointer flex-col gap-1 rounded-md border px-3 py-2 transition-colors hover:bg-muted/50 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5">
      <div className="flex min-w-0 items-center gap-3">
        <Checkbox
          checked={isSelected}
          onCheckedChange={onToggle}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {service.name}
        </span>
        {priceCents != null ? (
          <span
            className={
              isPriceOverride && hasClient
                ? "text-sm font-semibold tabular-nums text-primary"
                : "text-sm tabular-nums text-muted-foreground"
            }
            title={
              isPriceOverride && hasClient
                ? "Custom price for this client"
                : undefined
            }
          >
            {priceCents === 0 ? "Free" : formatPrice(priceCents)}
            {isPriceOverride && hasClient ? " *" : ""}
          </span>
        ) : null}
        <DurationBadge
          durationMinutes={duration}
          isOverride={isOverride && hasClient}
        />
      </div>
      {service.description ? (
        <p className="pl-8 text-xs text-muted-foreground">{service.description}</p>
      ) : null}
    </label>
  );
}

export function ServiceSelector({
  services,
  selectedServiceIds,
  onToggle,
  durationInfo,
  resolvedByService,
  hasClient,
}: ServiceSelectorProps) {
  // Prefer the per-selection durationInfo (which uses booking-time pricing),
  // falling back to the pre-resolved per-service info we fetched for the
  // whole list. This lets every row reflect the client's overrides even
  // before they're checked.
  const perSelectionMap = new Map(
    durationInfo?.services.map((s) => [s.serviceId, s]) ?? [],
  );
  const resolved = resolvedByService ?? new Map<string, ServiceDurationInfo>();

  const totalMinutes =
    durationInfo?.totalMinutes ??
    services
      .filter((s) => selectedServiceIds.includes(s.id))
      .reduce((sum, s) => {
        const info = resolved.get(s.id);
        return sum + (info?.durationMinutes ?? s.defaultDurationMinutes);
      }, 0);

  const totalCents = services
    .filter((s) => selectedServiceIds.includes(s.id))
    .reduce((sum, s) => {
      const info = perSelectionMap.get(s.id) ?? resolved.get(s.id);
      return sum + (info?.priceCents ?? 0);
    }, 0);

  const primary = services.filter((s) => (s.category ?? "other") !== "addon");
  const addons = services.filter((s) => (s.category ?? "other") === "addon");

  const renderSection = (title: string, list: Service[]) => {
    if (list.length === 0) return null;
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        <div className="space-y-1">
          {list.map((service) => {
            const isSelected = selectedServiceIds.includes(service.id);
            // Use per-selection info when the service is checked (matches what
            // createBooking will actually use), otherwise the pre-resolved
            // entry for this client+stylist so the row still reflects custom
            // values up front.
            const info =
              perSelectionMap.get(service.id) ?? resolved.get(service.id);
            const duration =
              info?.durationMinutes ?? service.defaultDurationMinutes;
            const isOverride = info?.isOverride ?? false;
            const priceCents = info?.priceCents ?? null;
            const isPriceOverride = info?.isPriceOverride ?? false;

            return (
              <ServiceRow
                key={service.id}
                service={service}
                isSelected={isSelected}
                duration={duration}
                isOverride={isOverride}
                priceCents={priceCents}
                isPriceOverride={isPriceOverride}
                hasClient={hasClient}
                onToggle={() => onToggle(service.id)}
              />
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-2">
      {!hasClient && selectedServiceIds.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Select a client to see personalized durations
        </p>
      )}

      <div className="max-h-56 space-y-3 overflow-y-auto pr-1">
        {renderSection("Services", primary)}
        {renderSection("Add-ons", addons)}
        {primary.length === 0 && addons.length === 0 && (
          <p className="text-sm text-muted-foreground">No services available.</p>
        )}
      </div>

      {selectedServiceIds.length > 0 && (
        <div className="flex items-center justify-between gap-2 border-t pt-2">
          <span className="text-sm font-medium">Total</span>
          <span className="text-sm font-medium tabular-nums">
            {totalCents > 0 ? `${formatPrice(totalCents)} · ` : ""}
            {totalMinutes} min
          </span>
        </div>
      )}
    </div>
  );
}
