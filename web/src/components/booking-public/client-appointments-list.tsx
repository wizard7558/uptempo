"use client";

import { format } from "date-fns";
import { TZDate } from "@date-fns/tz";
import Link from "next/link";
import type { AccountAppointmentRow } from "@/components/booking-public/account-hub";

interface Props {
  upcoming: AccountAppointmentRow[];
  past: AccountAppointmentRow[];
  errorMessage?: string;
  salonTimezone: string;
}

export function ClientAppointmentsList({
  upcoming,
  past,
  errorMessage,
  salonTimezone,
}: Props) {
  if (errorMessage) {
    return (
      <p className="text-sm text-destructive">
        {errorMessage === "Unauthorized"
          ? "Session expired. Book again to sign in."
          : errorMessage}
      </p>
    );
  }

  function AppointmentCard({
    row,
    showActions,
  }: {
    row: AccountAppointmentRow;
    showActions: boolean;
  }) {
    const start = new TZDate(new Date(row.start), salonTimezone);
    const end = new TZDate(new Date(row.end), salonTimezone);
    const when = format(start, "EEE, MMM d · h:mm a");
    const until = format(end, "h:mm a");

    return (
      <li className="editorial-card-hover border border-[var(--line)] p-4 space-y-3">
        <div className="flex justify-between gap-2">
          <p className="font-display text-lg font-light text-[var(--ink)]">{when} – {until}</p>
          <span className="text-xs uppercase tracking-[0.2em] text-[var(--ink-soft)]">
            {row.status}
          </span>
        </div>
        <p className="text-sm text-[var(--ink-soft)]">{row.staffName}</p>
        <p className="text-sm text-[var(--ink)]">
          {row.serviceNames.length > 0
            ? row.serviceNames.join(" · ")
            : "Services"}
        </p>
        {showActions && row.status !== "cancelled" && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Link
              href={`/reschedule/${row.rescheduleToken}`}
              className="editorial-link text-xs"
            >
              Reschedule
            </Link>
            <Link
              href={`/cancel/${row.cancelToken}`}
              className="editorial-link text-xs text-destructive"
            >
              Cancel
            </Link>
          </div>
        )}
      </li>
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <h3 className="eyebrow mb-2">Upcoming</h3>
        {upcoming.length === 0 ? (
          <p className="text-sm text-[var(--ink-soft)]">No upcoming visits.</p>
        ) : (
          <ul className="space-y-2">
            {upcoming.map((row) => (
              <AppointmentCard key={row.id} row={row} showActions />
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="eyebrow mb-2">Past</h3>
        {past.length === 0 ? (
          <p className="text-sm text-[var(--ink-soft)]">No past appointments yet.</p>
        ) : (
          <ul className="space-y-2">
            {past.map((row) => (
              <AppointmentCard key={row.id} row={row} showActions={false} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
