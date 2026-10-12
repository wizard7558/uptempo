/**
 * Per-service and per-staff analytics. Pure: the queries live in
 * service-analytics-query.ts. Rules (D14-D17 of the Phase 1.7/1.9 plan):
 *  - cancelled visits are excluded everywhere;
 *  - revenue is the line price of completed visits, tips excluded;
 *  - "booked again" is the share of completed visits where the same client has
 *    another non-cancelled appointment that starts later (same staff member for
 *    the per-staff table);
 *  - new vs returning uses the booking-time snapshot, falling back to "returning"
 *    when the client has an earlier non-cancelled appointment;
 *  - hours booked include no-shows.
 */

export type ServiceLine = {
  appointmentId: string;
  clientId: string;
  staffId: string;
  staffName: string;
  serviceId: string;
  serviceName: string;
  status: string;
  startsAt: Date;
  clientStatusAtBooking: string | null;
  lineCents: number;
  lineMinutes: number;
};

export type VisitHistoryRow = {
  appointmentId: string;
  clientId: string;
  staffId: string;
  startsAt: Date;
};

export type ServiceMetricsRow = {
  id: string;
  name: string;
  bookings: number;
  completed: number;
  noShows: number;
  revenueCents: number;
  avgTicketCents: number | null;
  minutesBooked: number;
  hoursBooked: number;
  rebookRate: number | null;
  noShowRate: number | null;
  newClients: number;
  returningClients: number;
};

export type ServiceAnalytics = {
  byService: ServiceMetricsRow[];
  byStaff: ServiceMetricsRow[];
  totals: ServiceMetricsRow;
};

type Visit = {
  id: string;
  clientId: string;
  staffId: string;
  staffName: string;
  status: string;
  startsAtMs: number;
  snapshot: string | null;
  cents: number;
  minutes: number;
  services: Map<string, { name: string; cents: number; minutes: number }>;
};

type Acc = {
  id: string;
  name: string;
  bookings: number;
  completed: number;
  noShows: number;
  revenueCents: number;
  minutes: number;
  rebookedCompleted: number;
  newClients: number;
  returningClients: number;
};

const newAcc = (id: string, name: string): Acc => ({
  id,
  name,
  bookings: 0,
  completed: 0,
  noShows: 0,
  revenueCents: 0,
  minutes: 0,
  rebookedCompleted: 0,
  newClients: 0,
  returningClients: 0,
});

function finish(a: Acc): ServiceMetricsRow {
  return {
    id: a.id,
    name: a.name,
    bookings: a.bookings,
    completed: a.completed,
    noShows: a.noShows,
    revenueCents: a.revenueCents,
    avgTicketCents: a.completed ? Math.round(a.revenueCents / a.completed) : null,
    minutesBooked: a.minutes,
    hoursBooked: Math.round(a.minutes / 6) / 10,
    rebookRate: a.completed ? a.rebookedCompleted / a.completed : null,
    noShowRate: a.bookings ? a.noShows / a.bookings : null,
    newClients: a.newClients,
    returningClients: a.returningClients,
  };
}

const bySort = (a: ServiceMetricsRow, b: ServiceMetricsRow) =>
  b.revenueCents - a.revenueCents ||
  b.bookings - a.bookings ||
  a.name.localeCompare(b.name);

export function computeServiceAnalytics(
  lines: ServiceLine[],
  history: VisitHistoryRow[],
): ServiceAnalytics {
  const visits = new Map<string, Visit>();
  for (const l of lines) {
    if (l.status === "cancelled") continue;
    let v = visits.get(l.appointmentId);
    if (!v) {
      v = {
        id: l.appointmentId,
        clientId: l.clientId,
        staffId: l.staffId,
        staffName: l.staffName,
        status: l.status,
        startsAtMs: l.startsAt.getTime(),
        snapshot: l.clientStatusAtBooking,
        cents: 0,
        minutes: 0,
        services: new Map(),
      };
      visits.set(l.appointmentId, v);
    }
    v.cents += l.lineCents;
    v.minutes += l.lineMinutes;
    const s = v.services.get(l.serviceId) ?? {
      name: l.serviceName,
      cents: 0,
      minutes: 0,
    };
    s.cents += l.lineCents;
    s.minutes += l.lineMinutes;
    v.services.set(l.serviceId, s);
  }

  const historyByClient = new Map<string, { id: string; staffId: string; ms: number }[]>();
  for (const h of history) {
    const list = historyByClient.get(h.clientId) ?? [];
    list.push({ id: h.appointmentId, staffId: h.staffId, ms: h.startsAt.getTime() });
    historyByClient.set(h.clientId, list);
  }

  const isReturning = (v: Visit): boolean => {
    if (v.snapshot === "new") return false;
    if (v.snapshot === "repeat") return true;
    return (historyByClient.get(v.clientId) ?? []).some(
      (h) => h.id !== v.id && h.ms < v.startsAtMs,
    );
  };
  const rebooked = (v: Visit, sameStaff: boolean): boolean =>
    (historyByClient.get(v.clientId) ?? []).some(
      (h) =>
        h.id !== v.id &&
        h.ms > v.startsAtMs &&
        (!sameStaff || h.staffId === v.staffId),
    );

  const services = new Map<string, Acc>();
  const staff = new Map<string, Acc>();
  const totals = newAcc("total", "");

  for (const v of visits.values()) {
    const completed = v.status === "completed";
    const noShow = v.status === "no_show";
    const returning = isReturning(v);
    const rebookedAny = completed && rebooked(v, false);
    const rebookedSame = completed && rebooked(v, true);

    const apply = (
      a: Acc,
      revenue: number,
      minutes: number,
      rebookedFlag: boolean,
    ) => {
      a.bookings += 1;
      if (completed) {
        a.completed += 1;
        a.revenueCents += revenue;
        if (rebookedFlag) a.rebookedCompleted += 1;
      }
      if (noShow) a.noShows += 1;
      a.minutes += minutes;
      if (returning) a.returningClients += 1;
      else a.newClients += 1;
    };

    apply(totals, v.cents, v.minutes, rebookedAny);

    let st = staff.get(v.staffId);
    if (!st) staff.set(v.staffId, (st = newAcc(v.staffId, v.staffName)));
    apply(st, v.cents, v.minutes, rebookedSame);

    for (const [serviceId, s] of v.services) {
      let sv = services.get(serviceId);
      if (!sv) services.set(serviceId, (sv = newAcc(serviceId, s.name)));
      apply(sv, s.cents, s.minutes, rebookedAny);
    }
  }

  return {
    byService: [...services.values()].map(finish).sort(bySort),
    byStaff: [...staff.values()].map(finish).sort(bySort),
    totals: finish(totals),
  };
}
