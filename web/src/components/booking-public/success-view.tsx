"use client";

import { useT } from "@/lib/terms/client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { TZDate } from "@date-fns/tz";
import { generateCalendarLinks } from "@/lib/booking/calendar-links";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ImessageOptIn } from "@/components/booking-public/imessage-opt-in";
import { MembershipUpsell } from "@/components/booking-public/membership-upsell";
import {
  CheckCircle2Icon,
  CalendarIcon,
  ClockIcon,
  UserIcon,
  ScissorsIcon,
  DownloadIcon,
  MapPinIcon,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BookingDetails {
  id: string;
  staffName: string;
  services: { name: string; durationMinutes: number }[];
  start: string;
  end: string;
  totalDuration: number;
  locationName?: string | null;
  locationAddress?: string | null;
}

interface SuccessViewProps {
  booking: BookingDetails;
  businessName: string;
  businessTimezone: string;
  businessSlug: string;
  clientId: string | null;
  onBookAnother: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SuccessView({
  booking,
  businessName,
  businessTimezone,
  businessSlug,
  clientId,
  onBookAnother,
}: SuccessViewProps) {
  const t = useT("booking");
  const router = useRouter();

  // The booking just mutated server state — drop the client router cache so
  // prefetched routes (e.g. the native tab bar's Account tab) show the new
  // appointment instead of a stale prefetch.
  useEffect(() => {
    router.refresh();
  }, [router]);

  const startDate = new TZDate(new Date(booking.start), businessTimezone);
  const endDate = new TZDate(new Date(booking.end), businessTimezone);

  const formattedDate = format(startDate, "EEEE, MMMM d, yyyy");
  const formattedStartTime = format(startDate, "h:mm a");
  const formattedEndTime = format(endDate, "h:mm a");

  const serviceSummary = booking.services.map((s) => s.name).join(" + ");
  const calendarLocation =
    [booking.locationName, booking.locationAddress]
      .filter((value): value is string => Boolean(value))
      .join(" - ") || undefined;

  const calendarLinks = generateCalendarLinks({
    staffName: booking.staffName,
    serviceSummary,
    start: new Date(booking.start),
    end: new Date(booking.end),
    businessName,
    location: calendarLocation,
  });

  return (
    <div className="space-y-6">
      {/* Success header */}
      <div className="flex flex-col items-center gap-3 pt-2 text-center">
        <CheckCircle2Icon className="size-12 animate-book-check text-[var(--ink-soft)]" />
        <div>
          <h2 className="display text-4xl text-[var(--ink)]">You&apos;re booked!</h2>
          <p className="text-sm text-[var(--ink-soft)]">
            Your appointment has been confirmed
          </p>
        </div>
      </div>

      {/* Booking details receipt */}
      <div className="border border-[var(--line)] bg-[var(--ivory-raised)]">
        <div className="divide-y">
          {/* Staff */}
          <div className="flex items-center gap-3 px-4 py-3">
            <UserIcon className="size-4 shrink-0 text-[var(--ink-soft)]" />
            <div>
              <p className="text-[13px] uppercase tracking-[0.2em] text-[var(--ink-soft)]">{t("successView.staffLabel")}</p>
              <p className="text-sm font-medium">{booking.staffName}</p>
            </div>
          </div>

          {/* Services */}
          <div className="flex items-start gap-3 px-4 py-3">
            <ScissorsIcon className="mt-0.5 size-4 shrink-0 text-[var(--ink-soft)]" />
            <div>
              <p className="text-[13px] uppercase tracking-[0.2em] text-[var(--ink-soft)]">Services</p>
              <div className="space-y-0.5">
                {booking.services.map((svc, i) => (
                  <p key={i} className="text-sm font-medium">
                    {svc.name}
                  </p>
                ))}
              </div>
            </div>
          </div>

          {/* Date */}
          <div className="flex items-center gap-3 px-4 py-3">
            <CalendarIcon className="size-4 shrink-0 text-[var(--ink-soft)]" />
            <div>
              <p className="text-[13px] uppercase tracking-[0.2em] text-[var(--ink-soft)]">Date</p>
              <p className="text-sm font-medium">{formattedDate}</p>
            </div>
          </div>

          {/* Time */}
          <div className="flex items-center gap-3 px-4 py-3">
            <ClockIcon className="size-4 shrink-0 text-[var(--ink-soft)]" />
            <div>
              <p className="text-[13px] uppercase tracking-[0.2em] text-[var(--ink-soft)]">Time</p>
              <p className="text-sm font-medium">
                {formattedStartTime} &ndash; {formattedEndTime}
              </p>
            </div>
          </div>

          {(booking.locationName || booking.locationAddress) && (
            <div className="flex items-start gap-3 px-4 py-3">
              <MapPinIcon className="mt-0.5 size-4 shrink-0 text-[var(--ink-soft)]" />
              <div>
                <p className="text-[13px] uppercase tracking-[0.2em] text-[var(--ink-soft)]">Location</p>
                {booking.locationName && (
                  <p className="text-sm font-medium">{booking.locationName}</p>
                )}
                {booking.locationAddress && (
                  <p className="text-sm text-[var(--ink-soft)]">
                    {booking.locationAddress}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Duration */}
          <div className="flex items-center gap-3 px-4 py-3">
            <ClockIcon className="size-4 shrink-0 text-[var(--ink-soft)]" />
            <div>
              <p className="text-[13px] uppercase tracking-[0.2em] text-[var(--ink-soft)]">Duration</p>
              <p className="text-sm font-medium">{booking.totalDuration} minutes</p>
            </div>
          </div>

          {/* Reference */}
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="size-4 shrink-0 text-center text-[13px] text-[var(--ink-soft)]">#</span>
            <div>
              <p className="text-[13px] uppercase tracking-[0.2em] text-[var(--ink-soft)]">Reference</p>
              <p className="font-mono text-sm font-medium">
                {booking.id.slice(0, 8).toUpperCase()}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Stored-value membership upsell (self-gates: hidden for members / no plans) */}
      {clientId && (
        <MembershipUpsell businessSlug={businessSlug} clientId={clientId} />
      )}

      {/* Opt into iMessage reminders (no-op if not configured) */}
      <ImessageOptIn businessName={businessName} />

      {/* Add to Calendar */}
      <div className="space-y-3">
        <p className="text-center text-sm font-medium text-[var(--ink-soft)]">
          Add to your calendar
        </p>
        <div className="grid grid-cols-3 gap-2">
          <a
            href={calendarLinks.google}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-1.5 border border-[var(--line)] p-3 text-center transition-colors hover:bg-[var(--ivory-raised)]"
          >
            <CalendarIcon className="size-5 text-[var(--ink-soft)]" />
            <span className="text-[13px] font-medium">Google</span>
          </a>
          <a
            href={calendarLinks.outlook}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-1.5 border border-[var(--line)] p-3 text-center transition-colors hover:bg-[var(--ivory-raised)]"
          >
            <CalendarIcon className="size-5 text-[var(--ink-soft)]" />
            <span className="text-[13px] font-medium">Outlook</span>
          </a>
          <a
            href={calendarLinks.ical}
            download="appointment.ics"
            className="flex flex-col items-center gap-1.5 border border-[var(--line)] p-3 text-center transition-colors hover:bg-[var(--ivory-raised)]"
          >
            <DownloadIcon className="size-5 text-[var(--ink-soft)]" />
            <span className="text-[13px] font-medium">Apple / .ics</span>
          </a>
        </div>
      </div>

      {/* Book Another / Account */}
      <div className="flex flex-col gap-2">
        <Button variant="outline"  asChild className="w-full">
          <Link href="/account">My Account</Link>
        </Button>
        <Button
          variant="outline"
          
          onClick={onBookAnother}
          className="w-full"
        >
          Book Another Appointment
        </Button>
      </div>
    </div>
  );
}
