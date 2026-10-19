"use client";

import { ServiceStep } from "@/components/booking-public/service-step";
import { TimeStep } from "@/components/booking-public/time-step";
import {
  bookingThemeStyle,
  brandColorNote,
  effectiveBrandColor,
  type BookingThemeSettings,
} from "@/lib/booking/theme";
import { useT } from "@/lib/terms/client";

const SAMPLE_DATE = "2026-10-20";

export function BookingPreview({ settings }: { settings: BookingThemeSettings }) {
  const t = useT("settings");
  const theme = bookingThemeStyle(settings);
  const note = brandColorNote(settings);
  const effective = effectiveBrandColor(settings);

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-medium">{t("branding.previewLabel")}</h2>
      {note ? (
        <div className="space-y-3">
          <p role="status">{note === "darkened" ? t("branding.darkened") : t("branding.lightened")}</p>
          <div className="flex gap-4">
            <Swatch color={settings.brandColor} label={t("branding.swatchYours")} />
            <Swatch color={effective} label={t("branding.swatchOnPage")} />
          </div>
        </div>
      ) : null}
      <div
        className={`${theme.className} overflow-hidden border border-border bg-background p-4 text-foreground`}
        style={theme.style}
        data-density={theme.dataDensity}
        data-theme-scope="booking-preview"
      >
        <div className="space-y-8">
          <ServiceStep
            businessId="preview"
            clientId={null}
            selectedStaffId="any"
            selectedServiceIds={["signature"]}
            initialStaff={[
              {
                id: "preview-stylist",
                displayName: t("branding.previewStaff"),
                photoUrl: null,
                bio: null,
                services: [],
              },
            ]}
            sampleServices={[
              {
                serviceId: "signature",
                serviceName: t("branding.previewServiceA"),
                durationMinutes: 60,
                priceCents: 8500,
                category: "featured",
              },
              {
                serviceId: "quick",
                serviceName: t("branding.previewServiceB"),
                durationMinutes: 30,
                priceCents: 4500,
                category: "featured",
              },
            ]}
            onComplete={() => {}}
          />
          <TimeStep
            staffId="any"
            locationId="preview"
            needsAddress={false}
            onLocation={() => {}}
            onAddress={() => {}}
            serviceIds={["signature"]}
            businessTimezone="UTC"
            selectedDate={null}
            selectedTime={null}
            sampleSchedule={{
              dates: [
                { date: SAMPLE_DATE, hasSlots: true },
                { date: "2026-10-21", hasSlots: true },
              ],
              slots: [
                {
                  time: "2026-10-20T15:00:00.000Z",
                  isDoubleBook: false,
                  doubleBookParentAppointmentId: null,
                },
                {
                  time: "2026-10-20T18:30:00.000Z",
                  isDoubleBook: false,
                  doubleBookParentAppointmentId: null,
                },
              ],
            }}
            onComplete={() => {}}
          />
        </div>
      </div>
    </div>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <div className="space-y-1">
      <div
        className="size-11 rounded-md border border-border"
        style={{ backgroundColor: color }}
      />
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
