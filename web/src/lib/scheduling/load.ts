/**
 * Database loading for the scheduling engine. Server-only: never import this
 * from client components. Everything the engine needs for a date range comes
 * back from one parallel wave of queries, so the cost does not grow with the
 * number of appointments or days.
 */
import { and, asc, between, eq, gt, inArray, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";
import { wallClockToDate } from "./intervals";
import type { DateOverride, LocationType, Resource, Rules } from "./types";

export type BusySource = "appointment" | "block" | "external" | "task";

const ALL_SOURCES: readonly BusySource[] = ["appointment", "block", "external", "task"];

export type SchedulingSettings = {
  timezone: string;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  slotIntervalMinutes: number;
  sameDayBooking: boolean;
  /** Minutes of the arrival window shown for on-site jobs (0 = exact time). */
  arrivalWindowMin: number;
};

export type HoursRow = {
  staffId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  locationId: string | null;
};

export type AppointmentRow = {
  id: string;
  staffId: string;
  start: Date;
  end: Date;
  locationId: string | null;
  isDoubleBook: boolean;
  parentId: string | null;
  activeMinutes: number | null;
  processingMinutes: number | null;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
};

export type IntervalRow = { staffId: string; start: Date; end: Date };

export type SchedulingSnapshot = {
  timezone: string;
  fromDay: string;
  toDay: string;
  locationId: string | null;
  hours: HoursRow[];
  overrides: DateOverride[];
  appointments: AppointmentRow[];
  timeBlocks: IntervalRow[];
  external: IntervalRow[];
  tasks: IntervalRow[];
  resources: Resource[];
  resourceUses: { resourceId: string; appointmentId: string; start: Date; end: Date }[];
};

/** Per-service timing and booking rules (null = use the business setting). */
export type ServiceTimingRow = {
  id: string;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  minNoticeMin: number | null;
  maxAdvanceDays: number | null;
  slotIntervalMin: number | null;
  locationType: LocationType;
};

export const DEFAULT_TIMEZONE = "America/New_York";

/**
 * Time zone and booking rules for a tenant. The time zone always comes from
 * `business_settings`, never from the client.
 */
export async function loadSchedulingSettings(slug: string): Promise<SchedulingSettings> {
  const rows = await withTenantDb(slug, async (db, { businessSettings }) =>
    db
      .select({
        timezone: businessSettings.timezone,
        minNoticeMinutes: businessSettings.minNoticeMinutes,
        maxAdvanceDays: businessSettings.maxAdvanceDays,
        slotIntervalMinutes: businessSettings.slotIntervalMinutes,
        sameDayBooking: businessSettings.sameDayBooking,
        arrivalWindowMin: businessSettings.arrivalWindowMin,
      })
      .from(businessSettings)
      .limit(1),
  );
  const row = rows[0];
  if (!row) {
    // No settings row yet (it is created on first admin visit): keep the
    // legacy rules: 28-day horizon, 15-minute grid, earliest booking tomorrow.
    return {
      timezone: DEFAULT_TIMEZONE,
      minNoticeMinutes: 0,
      maxAdvanceDays: 28,
      slotIntervalMinutes: 15,
      sameDayBooking: false,
      arrivalWindowMin: 120,
    };
  }
  return {
    timezone: row.timezone,
    minNoticeMinutes: row.minNoticeMinutes,
    maxAdvanceDays: row.maxAdvanceDays,
    slotIntervalMinutes: row.slotIntervalMinutes,
    sameDayBooking: row.sameDayBooking === 1,
    arrivalWindowMin: row.arrivalWindowMin,
  };
}

/** Extra booking-horizon days granted by an active priority-booking membership. */
export async function loadPriorityExtraDays(
  slug: string,
  clientId: string | null,
): Promise<number> {
  if (!clientId) return 0;
  return withTenantDb(slug, async (db, tables) => {
    const { clientMemberships, membershipPlans } = tables;
    const [row] = await db
      .select({
        priorityBooking: membershipPlans.priorityBooking,
        days: membershipPlans.priorityBookingDays,
      })
      .from(clientMemberships)
      .innerJoin(membershipPlans, eq(clientMemberships.planId, membershipPlans.id))
      .where(
        and(eq(clientMemberships.clientId, clientId), eq(clientMemberships.status, "active")),
      )
      .limit(1);
    if (!row || row.priorityBooking !== 1) return 0;
    return Math.max(0, row.days ?? 0);
  });
}

export type SnapshotParams = {
  slug: string;
  timezone: string;
  staffIds: string[];
  fromDay: string;
  toDay: string;
  locationId: string | null;
  excludeAppointmentIds?: string[];
  kinds?: readonly BusySource[];
  /** Offered waitlist rows count as busy blocks. Public booking sets this. */
  includeHolds?: boolean;
  /** The claimant's own offer is not busy for them. */
  excludeHoldIds?: string[];
  /** Holds with offer_expires_at at or before this instant are ignored. */
  asOf?: Date;
};

function emptySnapshot(p: SnapshotParams): SchedulingSnapshot {
  return {
    timezone: p.timezone,
    fromDay: p.fromDay,
    toDay: p.toDay,
    locationId: p.locationId,
    hours: [],
    overrides: [],
    appointments: [],
    timeBlocks: [],
    external: [],
    tasks: [],
    resources: [],
    resourceUses: [],
  };
}

/**
 * Loads working hours and every busy source for `staffIds` over
 * `[fromDay 00:00, toDay 24:00)` in the tenant time zone.
 * Round trips: one parallel wave of up to ten queries, regardless of how many
 * appointments, staff or days are involved. The tenth query loads waitlist holds.
 */
export async function loadSchedulingSnapshot(p: SnapshotParams): Promise<SchedulingSnapshot> {
  const snap = emptySnapshot(p);
  if (p.staffIds.length === 0) return snap;

  const kinds = new Set<BusySource>(p.kinds ?? ALL_SOURCES);
  const ids = p.staffIds;
  const loc = p.locationId;
  const tz = p.timezone;
  const rs = wallClockToDate(p.fromDay, "00:00", tz);
  const re = wallClockToDate(p.toDay, "24:00", tz);
  const range = sql`tstzrange(${rs.toISOString()}::timestamptz, ${re.toISOString()}::timestamptz, '[)')`;

  await withTenantDb(
    p.slug,
    async (
      db,
      {
        workingHours,
        availabilityOverrides,
        appointments,
        appointmentServices,
        services,
        timeBlocks,
        externalEvents,
        assistantTasks,
        resources,
        appointmentResources,
        slotWaitlist,
      },
    ) => {
      const apptWhere = and(
        inArray(appointments.staffId, ids),
        ne(appointments.status, "cancelled"),
        sql`${appointments.during} && ${range}`,
        loc ? or(isNull(appointments.locationId), eq(appointments.locationId, loc)) : undefined,
        p.excludeAppointmentIds?.length
          ? notInArray(appointments.id, p.excludeAppointmentIds)
          : undefined,
      );

      const hoursQ = db
        .select({
          staffId: workingHours.staffId,
          dayOfWeek: workingHours.dayOfWeek,
          startTime: workingHours.startTime,
          endTime: workingHours.endTime,
          locationId: workingHours.locationId,
        })
        .from(workingHours)
        .where(
          and(
            inArray(workingHours.staffId, ids),
            eq(workingHours.isEnabled, 1),
            loc ? eq(workingHours.locationId, loc) : undefined,
          ),
        );

      const overridesQ = db
        .select({
          staffId: availabilityOverrides.staffId,
          date: availabilityOverrides.date,
          intervals: availabilityOverrides.intervals,
        })
        .from(availabilityOverrides)
        .where(
          and(
            inArray(availabilityOverrides.staffId, ids),
            between(availabilityOverrides.date, p.fromDay, p.toDay),
          ),
        );

      const apptQ = kinds.has("appointment")
        ? db
            .select({
              id: appointments.id,
              staffId: appointments.staffId,
              during: appointments.during,
              locationId: appointments.locationId,
              isDoubleBook: appointments.isDoubleBook,
              parentId: appointments.doubleBookParentAppointmentId,
            })
            .from(appointments)
            .where(apptWhere)
        : Promise.resolve([]);

      const lineQ = kinds.has("appointment")
        ? db
            .select({
              appointmentId: appointmentServices.appointmentId,
              snapActive: appointmentServices.activeMinutes,
              snapProcessing: appointmentServices.processingMinutes,
              svcActive: services.activeMinutes,
              svcProcessing: services.processingMinutes,
              bufferBefore: services.bufferBeforeMin,
              bufferAfter: services.bufferAfterMin,
            })
            .from(appointmentServices)
            .innerJoin(services, eq(appointmentServices.serviceId, services.id))
            .where(
              inArray(
                appointmentServices.appointmentId,
                db.select({ id: appointments.id }).from(appointments).where(apptWhere),
              ),
            )
            .orderBy(
              asc(appointmentServices.appointmentId),
              asc(appointmentServices.createdAt),
              asc(appointmentServices.id),
            )
        : Promise.resolve([]);

      const blockQ = kinds.has("block")
        ? db
            .select({ staffId: timeBlocks.staffId, during: timeBlocks.during })
            .from(timeBlocks)
            .where(
              and(
                inArray(timeBlocks.staffId, ids),
                sql`${timeBlocks.during} && ${range}`,
                loc ? or(isNull(timeBlocks.locationId), eq(timeBlocks.locationId, loc)) : undefined,
              ),
            )
        : Promise.resolve([]);

      // Legacy behavior: external events are never filtered by location.
      const extQ = kinds.has("external")
        ? db
            .select({
              staffId: externalEvents.staffId,
              start: externalEvents.startTime,
              end: externalEvents.endTime,
            })
            .from(externalEvents)
            .where(
              and(
                inArray(externalEvents.staffId, ids),
                lt(externalEvents.startTime, re),
                gt(externalEvents.endTime, rs),
              ),
            )
        : Promise.resolve([]);

      const taskQ = kinds.has("task")
        ? db
            .select({ staffId: assistantTasks.assignedTo, during: assistantTasks.during })
            .from(assistantTasks)
            .where(
              and(
                inArray(assistantTasks.assignedTo, ids),
                inArray(assistantTasks.status, ["pending", "in-progress"]),
                sql`${assistantTasks.during} && ${range}`,
              ),
            )
        : Promise.resolve([]);

      // Resources and their uses are loaded for every mode: even an admin
      // override must not double-book a chair.
      const resourceQ = db
        .select({
          id: resources.id,
          kind: resources.kind,
          locationId: resources.locationId,
          capacity: resources.capacity,
        })
        .from(resources)
        .where(
          and(
            eq(resources.isActive, 1),
            loc ? or(isNull(resources.locationId), eq(resources.locationId, loc)) : undefined,
          ),
        )
        .orderBy(asc(resources.createdAt), asc(resources.id));

      const useQ = db
        .select({
          resourceId: appointmentResources.resourceId,
          appointmentId: appointmentResources.appointmentId,
          during: appointmentResources.during,
        })
        .from(appointmentResources)
        .innerJoin(appointments, eq(appointments.id, appointmentResources.appointmentId))
        .where(
          and(
            ne(appointments.status, "cancelled"),
            sql`${appointmentResources.during} && ${range}`,
            p.excludeAppointmentIds?.length
              ? notInArray(appointments.id, p.excludeAppointmentIds)
              : undefined,
          ),
        );

      const asOf = p.asOf ?? new Date();
      const holdsQ = p.includeHolds
        ? db
            .select({
              staffId: slotWaitlist.offeredStaffId,
              start: slotWaitlist.offeredStart,
              end: slotWaitlist.offeredEnd,
            })
            .from(slotWaitlist)
            .where(
              and(
                eq(slotWaitlist.status, "offered"),
                sql`${slotWaitlist.offerExpiresAt} > ${asOf.toISOString()}::timestamptz`,
                inArray(slotWaitlist.offeredStaffId, ids),
                sql`tstzrange(${slotWaitlist.offeredStart}, ${slotWaitlist.offeredEnd}, '[)') && ${range}`,
                p.excludeHoldIds?.length
                  ? notInArray(slotWaitlist.id, p.excludeHoldIds)
                  : undefined,
              ),
            )
        : Promise.resolve(
            [] as { staffId: string | null; start: Date | null; end: Date | null }[],
          );

      const [hours, overrideRows, appts, lines, blocks, ext, tasks, resourceRows, useRows, holds] =
        await Promise.all([
          hoursQ,
          overridesQ,
          apptQ,
          lineQ,
          blockQ,
          extQ,
          taskQ,
          resourceQ,
          useQ,
          holdsQ,
        ]);

      snap.hours = hours;
      snap.resources = resourceRows;
      snap.resourceUses = useRows.map((u) => ({
        resourceId: u.resourceId,
        appointmentId: u.appointmentId,
        start: u.during.start,
        end: u.during.end,
      }));
      // A location-scoped query keeps only the intervals at that location; an
      // empty list then means closed at this location.
      snap.overrides = overrideRows.map((o) => ({
        staffId: o.staffId,
        date: o.date,
        intervals: loc ? o.intervals.filter((i) => i.locationId === loc) : o.intervals,
      }));

      // The first line item (by creation order) sets the processing gap: the
      // appointment snapshot wins when both of its fields are set, otherwise the
      // service's own values are used.
      const gapByAppt = new Map<string, { active: number | null; processing: number | null }>();
      // The buffer around an appointment is the largest over all its lines.
      const bufferByAppt = new Map<string, { before: number; after: number }>();
      for (const l of lines) {
        const buf = bufferByAppt.get(l.appointmentId);
        bufferByAppt.set(l.appointmentId, {
          before: Math.max(buf?.before ?? 0, l.bufferBefore),
          after: Math.max(buf?.after ?? 0, l.bufferAfter),
        });
        if (gapByAppt.has(l.appointmentId)) continue;
        if (l.snapActive != null && l.snapProcessing != null) {
          gapByAppt.set(l.appointmentId, { active: l.snapActive, processing: l.snapProcessing });
        } else {
          gapByAppt.set(l.appointmentId, { active: l.svcActive, processing: l.svcProcessing });
        }
      }

      snap.appointments = appts.map((a) => {
        const gap = gapByAppt.get(a.id);
        return {
          id: a.id,
          staffId: a.staffId,
          start: a.during.start,
          end: a.during.end,
          locationId: a.locationId,
          isDoubleBook: a.isDoubleBook === 1,
          parentId: a.parentId,
          activeMinutes: gap?.active ?? null,
          processingMinutes: gap?.processing ?? null,
          bufferBeforeMinutes: bufferByAppt.get(a.id)?.before ?? 0,
          bufferAfterMinutes: bufferByAppt.get(a.id)?.after ?? 0,
        };
      });
      snap.timeBlocks = blocks.map((b) => ({
        staffId: b.staffId,
        start: b.during.start,
        end: b.during.end,
      }));
      for (const h of holds) {
        if (h.staffId && h.start && h.end) {
          snap.timeBlocks.push({ staffId: h.staffId, start: h.start, end: h.end });
        }
      }
      snap.external = ext.map((e) => ({ staffId: e.staffId, start: e.start, end: e.end }));
      snap.tasks = tasks.map((t) => ({
        staffId: t.staffId,
        start: t.during.start,
        end: t.during.end,
      }));
    },
  );

  return snap;
}

/** Timing and booking rules for the given services. Unknown ids are skipped. */
export async function loadServiceTiming(slug: string, ids: string[]): Promise<ServiceTimingRow[]> {
  if (ids.length === 0) return [];
  const rows = await withTenantDb(slug, async (db, { services }) =>
    db
      .select({
        id: services.id,
        bufferBeforeMin: services.bufferBeforeMin,
        bufferAfterMin: services.bufferAfterMin,
        minNoticeMin: services.minNoticeMin,
        maxAdvanceDays: services.maxAdvanceDays,
        slotIntervalMin: services.slotIntervalMin,
        locationType: services.locationType,
      })
      .from(services)
      .where(inArray(services.id, ids)),
  );
  return rows.map((r) => ({ ...r, locationType: r.locationType as LocationType }));
}

/** What a service needs from rooms and equipment (rows of service_resource_requirements). */
export type ServiceNeedRow = {
  serviceId: string;
  resourceKind: string | null;
  resourceId: string | null;
  quantity: number;
  offsetMin: number;
  durationMin: number | null;
};

/** Resource needs of the given services. Services without needs contribute no rows. */
export async function loadServiceNeeds(slug: string, ids: string[]): Promise<ServiceNeedRow[]> {
  if (ids.length === 0) return [];
  return withTenantDb(slug, async (db, { serviceResourceRequirements: srr }) =>
    db
      .select({
        serviceId: srr.serviceId,
        resourceKind: srr.resourceKind,
        resourceId: srr.resourceId,
        quantity: srr.quantity,
        offsetMin: srr.offsetMin,
        durationMin: srr.durationMin,
      })
      .from(srr)
      .where(inArray(srr.serviceId, ids))
      .orderBy(asc(srr.createdAt), asc(srr.id)),
  );
}

/**
 * Active staff who offer **all** of `serviceIds`, in display-name order. These
 * are the people "Anyone available" may assign.
 */
export async function loadAnyStaffCandidates(slug: string, serviceIds: string[]): Promise<string[]> {
  const ids = [...new Set(serviceIds)];
  if (ids.length === 0) return [];
  const rows = await withTenantDb(slug, async (db, { staff, staffServices }) =>
    db
      .select({ staffId: staffServices.staffId })
      .from(staffServices)
      .innerJoin(staff, eq(staff.id, staffServices.staffId))
      .where(
        and(
          eq(staff.isActive, 1),
          eq(staffServices.isOffered, 1),
          inArray(staffServices.serviceId, ids),
        ),
      )
      .groupBy(staffServices.staffId)
      .having(sql`count(distinct ${staffServices.serviceId}) = ${ids.length}`)
      .orderBy(sql`min(${staff.displayName})`, asc(staffServices.staffId)),
  );
  return rows.map((r) => r.staffId);
}

/** Display names for the given staff ids. */
export async function loadStaffNames(slug: string, staffIds: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(staffIds)];
  if (ids.length === 0) return {};
  const rows = await withTenantDb(slug, async (db, { staff }) =>
    db.select({ id: staff.id, displayName: staff.displayName }).from(staff).where(inArray(staff.id, ids)),
  );
  return Object.fromEntries(rows.map((r) => [r.id, r.displayName]));
}

export type BooksMode = "open" | "windows" | "closed";

export type BookingWindowData = {
  /** Each requested staff member's `books_mode`. */
  modes: Record<string, BooksMode>;
  /** Direct-booking windows that overlap the range; `staffId: null` applies to everyone. */
  windows: { staffId: string | null; opensAt: Date; closesAt: Date }[];
};

/**
 * Books mode for `staffIds` plus the `mode = 'direct'` windows that overlap
 * `[from, to)`. Request-only windows never open online booking.
 */
export async function loadBookingWindows(
  slug: string,
  staffIds: string[],
  from: Date,
  to: Date,
): Promise<BookingWindowData> {
  if (staffIds.length === 0) return { modes: {}, windows: [] };
  return withTenantDb(slug, async (db, { staff, bookingWindows }) => {
    const [modeRows, windowRows] = await Promise.all([
      db.select({ id: staff.id, mode: staff.booksMode }).from(staff).where(inArray(staff.id, staffIds)),
      db
        .select({
          staffId: bookingWindows.staffId,
          opensAt: bookingWindows.opensAt,
          closesAt: bookingWindows.closesAt,
        })
        .from(bookingWindows)
        .where(
          and(
            eq(bookingWindows.mode, "direct"),
            lt(bookingWindows.opensAt, to),
            gt(bookingWindows.closesAt, from),
            or(isNull(bookingWindows.staffId), inArray(bookingWindows.staffId, staffIds)),
          ),
        ),
    ]);
    const modes: Record<string, BooksMode> = {};
    for (const r of modeRows) modes[r.id] = r.mode as BooksMode;
    return { modes, windows: windowRows };
  });
}

/**
 * The engine's `bookingWindows` rule: no entry for open staff, `[]` for closed
 * staff, and the staff member's own plus business-wide direct windows for
 * `windows` staff. Undefined when nobody is restricted.
 */
export function bookingWindowRules(
  data: BookingWindowData,
  staffIds: string[],
): Rules["bookingWindows"] {
  const out: NonNullable<Rules["bookingWindows"]> = {};
  for (const id of staffIds) {
    const mode = data.modes[id] ?? "open";
    if (mode === "closed") out[id] = [];
    else if (mode === "windows") {
      out[id] = data.windows
        .filter((w) => w.staffId === null || w.staffId === id)
        .map((w) => ({ opensAt: w.opensAt, closesAt: w.closesAt }));
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
