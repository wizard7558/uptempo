import { google, outlook, ics } from "calendar-link";

interface CalendarLinkInput {
  staffName: string;
  serviceSummary: string;
  start: Date;
  end: Date;
  salonName: string;
  location?: string | null;
}

interface CalendarLinks {
  google: string;
  outlook: string;
  ical: string;
}

/**
 * Generate add-to-calendar URLs for Google Calendar, Outlook, and iCal.
 */
export function generateCalendarLinks(booking: CalendarLinkInput): CalendarLinks {
  const event = {
    title: `${booking.serviceSummary} with ${booking.staffName}`,
    description: `Appointment at ${booking.salonName}`,
    start: booking.start,
    end: booking.end,
    location: booking.location ?? undefined,
  };

  return {
    google: google(event),
    outlook: outlook(event),
    ical: ics(event),
  };
}
