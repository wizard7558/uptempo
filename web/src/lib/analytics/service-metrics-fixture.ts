import type {
  ServiceLine,
  ServiceMetricsRow,
  VisitHistoryRow,
} from "./service-metrics";

/**
 * Shared fixture for the unit test and the DB query test. Range:
 * 2030-03-01T00:00Z through 2030-03-31T23:59:59Z. A0 and A6 fall outside the
 * range and appear only in history; A5 is cancelled.
 */
export const FIXTURE_RANGE = {
  start: new Date("2030-03-01T00:00:00Z"),
  end: new Date("2030-03-31T23:59:59Z"),
};

const at = (iso: string) => new Date(`${iso}:00Z`);
const base = { staffName: "", serviceName: "" };

export const FIXTURE_LINES: ServiceLine[] = [
  { ...base, appointmentId: "A1", clientId: "C1", staffId: "S1", staffName: "Avery", serviceId: "SV1", serviceName: "Cut", status: "completed", startsAt: at("2030-03-02T15:00"), clientStatusAtBooking: "new", lineCents: 5000, lineMinutes: 60 },
  { ...base, appointmentId: "A2", clientId: "C1", staffId: "S1", staffName: "Avery", serviceId: "SV1", serviceName: "Cut", status: "confirmed", startsAt: at("2030-03-20T15:00"), clientStatusAtBooking: "repeat", lineCents: 5000, lineMinutes: 60 },
  { ...base, appointmentId: "A3", clientId: "C2", staffId: "S2", staffName: "Blake", serviceId: "SV2", serviceName: "Color", status: "completed", startsAt: at("2030-03-05T16:00"), clientStatusAtBooking: null, lineCents: 11000, lineMinutes: 90 },
  { ...base, appointmentId: "A3", clientId: "C2", staffId: "S2", staffName: "Blake", serviceId: "SV1", serviceName: "Cut", status: "completed", startsAt: at("2030-03-05T16:00"), clientStatusAtBooking: null, lineCents: 5000, lineMinutes: 30 },
  { ...base, appointmentId: "A4", clientId: "C3", staffId: "S2", staffName: "Blake", serviceId: "SV2", serviceName: "Color", status: "no_show", startsAt: at("2030-03-06T16:00"), clientStatusAtBooking: "new", lineCents: 12000, lineMinutes: 120 },
];

/** Every non-cancelled appointment for the clients above: A0, A1, A2, A3, A4, A6. */
export const FIXTURE_HISTORY: VisitHistoryRow[] = [
  { appointmentId: "A0", clientId: "C2", staffId: "S1", startsAt: at("2030-02-01T15:00") },
  { appointmentId: "A1", clientId: "C1", staffId: "S1", startsAt: at("2030-03-02T15:00") },
  { appointmentId: "A2", clientId: "C1", staffId: "S1", startsAt: at("2030-03-20T15:00") },
  { appointmentId: "A3", clientId: "C2", staffId: "S2", startsAt: at("2030-03-05T16:00") },
  { appointmentId: "A4", clientId: "C3", staffId: "S2", startsAt: at("2030-03-06T16:00") },
  { appointmentId: "A6", clientId: "C2", staffId: "S1", startsAt: at("2030-04-10T15:00") },
];

/** Expected output, as (bookings, completed, noShows, revenue, avgTicket, hours, rebook, noShowRate, new, returning). */
export const FIXTURE_EXPECTED = {
  byService: [
    ["Color", 2, 1, 1, 11000, 11000, 3.5, 1, 0.5, 1, 1],
    ["Cut", 3, 2, 0, 10000, 5000, 2.5, 1, 0, 1, 2],
  ],
  byStaff: [
    ["Blake", 2, 1, 1, 16000, 16000, 4.0, 0, 0.5, 1, 1],
    ["Avery", 2, 1, 0, 5000, 5000, 2.0, 1, 0, 1, 1],
  ],
  totals: ["", 4, 2, 1, 21000, 10500, 6.0, 1, 0.25, 2, 2],
} as const;

/** Same projection the DB test uses, so both reproduce the plan's table. */
export function toTableRow(r: ServiceMetricsRow) {
  return [
    r.name,
    r.bookings,
    r.completed,
    r.noShows,
    r.revenueCents,
    r.avgTicketCents,
    r.hoursBooked,
    r.rebookRate,
    r.noShowRate,
    r.newClients,
    r.returningClients,
  ];
}

