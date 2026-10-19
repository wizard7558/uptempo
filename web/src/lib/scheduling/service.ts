/**
 * Server-side scheduling service: loads data, runs the pure engine, and
 * answers "what is bookable" and "may this booking happen". Not a server
 * action file; callers (actions) validate input and pass the tenant slug.
 */
import { computeSlots, evaluateStart, pickResourcesAt, staffWindows } from "./engine";
import { addDays, localDay, wallClockToDate } from "./intervals";
import {
  buildEngineInput,
  buildRules,
  buildServiceRequest,
  clipTravelToDay,
  dayLoadFor,
  simpleServiceRequest,
  snapshotBusy,
  type RequestTiming,
} from "./input";
import { pickLeastLoaded } from "./any-staff";
import { loadTravel } from "./load-travel";
import { hasModule } from "@/lib/tenant/modules";
import {
  bookingWindowRules,
  loadAnyStaffCandidates,
  loadBookingWindows,
  loadPriorityExtraDays,
  loadSchedulingSettings,
  loadSchedulingSnapshot,
  loadServiceNeeds,
  loadServiceTiming,
  type BusySource,
  type SchedulingSnapshot,
} from "./load";
import { withTenantDb } from "@/lib/db/tenant";
import { and, eq } from "drizzle-orm";
import { MODE_KINDS, MODE_REASONS, type BookingMode } from "./reasons";
import type { Busy, RejectReason, Rules, ServiceRequest, Slot, Travel } from "./types";
import { getMultiServiceDuration } from "@/lib/services/duration";

const MIN = 60_000;
const DAY_MS = 24 * 60 * MIN;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `staffId: "any"` asks for whoever is free (see `pickLeastLoaded`). */
export const ANY_STAFF = "any";

export type SlotQuery = {
  slug: string;
  staffId: string | typeof ANY_STAFF;
  locationId: string | null;
  serviceIds: string[];
  clientId: string | null;
  /**
   * Ordered line lengths that replace catalog durations. A quote carries its
   * own minutes. Resource needs then start after the lines before them, the
   * same way a booking check uses line overrides.
   */
  lineDurations?: { serviceId: string; durationMinutes: number }[];
  /**
   * Where an on-site job will happen (a `client_addresses` id). With the on_site module on
   * and an on-site service, travel time between jobs applies. Without it, on-site services
   * are scheduled like in-studio ones.
   */
  serviceAddressId?: string | null;
  now?: Date;
};

/** One person who could take the booking, with the length of time the services take them. */
type Candidate = { staffId: string; service: ServiceRequest };

async function prepareQuery(q: SlotQuery) {
  const now = q.now ?? new Date();
  const isAny = q.staffId === ANY_STAFF;
  const [settings, extraAdvanceDays, serviceTiming, serviceNeeds, staffIds, onSiteModule] = await Promise.all([
    loadSchedulingSettings(q.slug),
    loadPriorityExtraDays(q.slug, q.clientId),
    loadServiceTiming(q.slug, q.serviceIds),
    loadServiceNeeds(q.slug, q.serviceIds),
    isAny ? loadAnyStaffCandidates(q.slug, q.serviceIds) : Promise.resolve([q.staffId]),
    q.serviceAddressId ? hasModule(q.slug, "on_site") : Promise.resolve(false),
  ]);
  const hasTravel = onSiteModule && serviceTiming.some((t) => t.locationType === "on_site");
  // Each person's own durations and prices apply (per-staff overrides),
  // unless the caller already named each line's length.
  const quoted = q.lineDurations;
  const durations = await Promise.all(
    staffIds.map((id) =>
      quoted
        ? Promise.resolve({
            totalMinutes: quoted.reduce((sum, line) => sum + line.durationMinutes, 0),
            services: quoted.map((line) => ({
              serviceId: line.serviceId,
              durationMinutes: line.durationMinutes,
            })),
          })
        : getMultiServiceDuration(q.serviceIds, q.clientId, id, q.slug),
    ),
  );
  const candidates: Candidate[] = [];
  let timing: RequestTiming | null = null;
  durations.forEach((duration, i) => {
    const built = buildServiceRequest(duration, serviceTiming, serviceNeeds, hasTravel);
    timing = built.timing;
    if (duration.services.length > 0 && built.request.totalMinutes > 0) {
      candidates.push({ staffId: staffIds[i], service: built.request });
    }
  });
  const baseRules = buildRules(settings, now, {
    extraAdvanceDays,
    allowFlex: true,
    timing: timing ?? undefined,
  });
  // Online booking respects each person's books (open, closed, or only on set dates).
  const candidateIds = candidates.map((c) => c.staffId);
  const bookingWindows = bookingWindowRules(
    await loadBookingWindows(
      q.slug,
      candidateIds,
      new Date(now.getTime() - DAY_MS),
      new Date(now.getTime() + (baseRules.maxAdvanceDays + 2) * DAY_MS),
    ),
    candidateIds,
  );
  const rules: Rules = bookingWindows ? { ...baseRules, bookingWindows } : baseRules;
  return { now, settings, rules, candidates, isAny, hasTravel };
}

/** Travel inputs for a query over `[fromDay, toDay]`, or undefined when the query has no on-site job. */
async function travelFor(
  q: SlotQuery,
  prep: { hasTravel: boolean; settings: { timezone: string }; candidates: Candidate[] },
  fromDay: string,
  toDay: string,
): Promise<Travel | undefined> {
  if (!prep.hasTravel || !q.serviceAddressId) return undefined;
  return (
    (await loadTravel({
      slug: q.slug,
      staffIds: prep.candidates.map((c) => c.staffId),
      fromDay,
      toDay,
      timezone: prep.settings.timezone,
      addressId: q.serviceAddressId,
    })) ?? undefined
  );
}

/** Slots for one day: one candidate's own, or one per start across all candidates. */
function slotsForDay(
  snap: SchedulingSnapshot,
  day: string,
  p: { candidates: Candidate[]; rules: Rules; isAny: boolean; busy?: Busy[]; travel?: Travel },
): Slot[] {
  const all = p.candidates.flatMap((c) =>
    computeSlots(
      buildEngineInput(snap, day, {
        candidateStaffIds: [c.staffId],
        anyStaff: false,
        service: c.service,
        rules: p.rules,
        busy: p.busy,
        travel: p.travel ? clipTravelToDay(p.travel, day, snap.timezone) : undefined,
      }),
    ),
  );
  if (!p.isAny) return all;
  return pickLeastLoaded(
    all,
    p.candidates.map((c) => c.staffId),
    dayLoadFor(snap, day),
  );
}

/** Bookable slots for one staff member (or "any") on one local day. */
export async function listDaySlots(q: SlotQuery & { day: string }): Promise<Slot[]> {
  if (!DAY_RE.test(q.day)) return [];
  const prep = await prepareQuery(q);
  if (prep.candidates.length === 0) return [];
  const snap = await loadSchedulingSnapshot({
    slug: q.slug,
    timezone: prep.settings.timezone,
    staffIds: prep.candidates.map((c) => c.staffId),
    fromDay: q.day,
    toDay: q.day,
    locationId: q.locationId,
    includeHolds: true,
    asOf: prep.now,
  });
  const travel = await travelFor(q, prep, q.day, q.day);
  return slotsForDay(snap, q.day, { ...prep, travel });
}

/** Local days (YYYY-MM-DD) in the booking horizon that have at least one slot. One snapshot covers the whole range. */
export async function listBookableDays(q: SlotQuery): Promise<string[]> {
  const prep = await prepareQuery(q);
  if (prep.candidates.length === 0) return [];
  const { now, settings, rules } = prep;
  const fromDay = localDay(now, settings.timezone);
  const toDay = addDays(fromDay, rules.maxAdvanceDays);
  const snap = await loadSchedulingSnapshot({
    slug: q.slug,
    timezone: settings.timezone,
    staffIds: prep.candidates.map((c) => c.staffId),
    fromDay,
    toDay,
    locationId: q.locationId,
    includeHolds: true,
    asOf: now,
  });
  const busy = snapshotBusy(snap);
  const travel = await travelFor(q, prep, fromDay, toDay);
  const days: string[] = [];
  for (let day = fromDay; day <= toDay; day = addDays(day, 1)) {
    if (slotsForDay(snap, day, { ...prep, busy, travel }).length > 0) days.push(day);
  }
  return days;
}

export type CheckBookingParams = {
  slug: string;
  staffId: string;
  start: Date;
  services: { serviceId: string; durationMinutes: number }[];
  totalMinutes: number;
  locationId: string | null;
  mode: BookingMode;
  clientId?: string | null;
  excludeAppointmentIds?: string[];
  extraBusy?: Busy[];
  /** Where an on-site job will happen; see `SlotQuery.serviceAddressId`. */
  serviceAddressId?: string | null;
  /** The claimant's own waitlist hold is not busy. */
  ignoreHoldIds?: string[];
  now?: Date;
};

export type CheckBookingResult =
  | { ok: true; resources: { resourceId: string; start: Date; end: Date }[] }
  | { ok: false; reasons: RejectReason[] };

/** Decides whether one concrete booking may be created. Which reasons reject depends on `mode`. */
export async function checkBooking(p: CheckBookingParams): Promise<CheckBookingResult> {
  const now = p.now ?? new Date();
  const serviceIds = p.services.map((x) => x.serviceId);
  const [settings, serviceTiming, serviceNeeds, onSiteModule] = await Promise.all([
    loadSchedulingSettings(p.slug),
    loadServiceTiming(p.slug, serviceIds),
    loadServiceNeeds(p.slug, serviceIds),
    p.serviceAddressId ? hasModule(p.slug, "on_site") : Promise.resolve(false),
  ]);
  const hasTravel = onSiteModule && serviceTiming.some((t) => t.locationType === "on_site");
  const { request: service, timing } = buildServiceRequest(
    { totalMinutes: p.totalMinutes, services: p.services },
    serviceTiming,
    serviceNeeds,
    hasTravel,
  );
  const startMs = p.start.getTime();
  const endMs = startMs + p.totalMinutes * MIN;
  const first = new Date(startMs - service.bufferBeforeMinutes * MIN);
  const last = new Date(endMs + service.bufferAfterMinutes * MIN - 1);
  const fromDay = localDay(first, settings.timezone);
  const toDay = localDay(last, settings.timezone);

  const extraAdvanceDays =
    p.mode === "public" ? await loadPriorityExtraDays(p.slug, p.clientId ?? null) : 0;
  // Public checks give the client a 10-minute grace so a slot that was listed
  // right at the notice boundary is still accepted when they confirm.
  const baseRules = buildRules(
    settings,
    p.mode === "public" ? new Date(now.getTime() - 10 * MIN) : now,
    { extraAdvanceDays, allowFlex: p.mode === "public", timing },
  );
  // Books open/closed only limits online booking; staff-side modes ignore it.
  const bookingWindows =
    p.mode === "public"
      ? bookingWindowRules(
          await loadBookingWindows(
            p.slug,
            [p.staffId],
            wallClockToDate(fromDay, "00:00", settings.timezone),
            wallClockToDate(toDay, "24:00", settings.timezone),
          ),
          [p.staffId],
        )
      : undefined;
  const rules: Rules = bookingWindows ? { ...baseRules, bookingWindows } : baseRules;

  const snap = await loadSchedulingSnapshot({
    slug: p.slug,
    timezone: settings.timezone,
    staffIds: [p.staffId],
    fromDay,
    toDay,
    locationId: p.locationId,
    excludeAppointmentIds: p.excludeAppointmentIds,
    kinds: MODE_KINDS[p.mode],
    includeHolds: p.mode === "public",
    excludeHoldIds: p.ignoreHoldIds,
    asOf: now,
  });

  const travel =
    hasTravel && p.serviceAddressId
      ? ((await loadTravel({
          slug: p.slug,
          staffIds: [p.staffId],
          fromDay,
          toDay,
          timezone: settings.timezone,
          addressId: p.serviceAddressId,
          excludeAppointmentIds: p.excludeAppointmentIds,
        })) ?? undefined)
      : undefined;

  const input = buildEngineInput(snap, localDay(p.start, settings.timezone), {
    candidateStaffIds: [p.staffId],
    anyStaff: false,
    service,
    rules,
    busy: [...snapshotBusy(snap), ...(p.extraBusy ?? [])],
    clipToDay: false,
    travel,
  });

  const filter = MODE_REASONS[p.mode];
  const evaluation = evaluateStart(input, p.start, p.staffId);
  const reasons = evaluation.reasons.filter((r) => (filter ? filter.has(r) : true));
  if (reasons.length > 0) return { ok: false, reasons };

  // A slot exists only when no rule at all rejected it (public mode). Modes that
  // skip some rules (series, override, reschedule) pick the resources directly.
  const assignments = evaluation.slot
    ? (evaluation.slot.resourceAssignments ?? [])
    : pickResourcesAt(input, p.start, p.locationId);
  if (assignments === null) return { ok: false, reasons: ["RESOURCE_UNAVAILABLE"] };
  return {
    ok: true,
    resources: assignments.map((a) => ({
      resourceId: a.resourceId,
      start: a.interval.start,
      end: a.interval.end,
    })),
  };
}

/** Busy items for one staff member that overlap `[start, end)`. */
export async function findBusyConflicts(p: {
  slug: string;
  staffId: string;
  start: Date;
  end: Date;
  locationId: string | null;
  kinds: readonly BusySource[];
}): Promise<Busy[]> {
  const settings = await loadSchedulingSettings(p.slug);
  const snap = await loadSchedulingSnapshot({
    slug: p.slug,
    timezone: settings.timezone,
    staffIds: [p.staffId],
    fromDay: localDay(p.start, settings.timezone),
    toDay: localDay(new Date(p.end.getTime() - 1), settings.timezone),
    locationId: p.locationId,
    kinds: p.kinds,
  });
  const s = p.start.getTime();
  const e = p.end.getTime();
  return snapshotBusy(snap).filter(
    (b) => b.staffId === p.staffId && b.interval.start.getTime() < e && b.interval.end.getTime() > s,
  );
}

export type BookingLocation = { id: string; name: string; address: string | null };

/**
 * Off-shift location choice for override and series bookings, first match wins:
 * the requested location, the staff member's own weekly-schedule location (when
 * all their enabled shifts are at one location), the business's only location.
 * Inactive locations never count. Null when nothing applies (ambiguous).
 */
export function pickFallbackLocation(p: {
  requested: string | null;
  staffLocationIds: readonly string[];
  activeLocationIds: readonly string[];
}): string | null {
  const active = new Set(p.activeLocationIds);
  if (p.requested && active.has(p.requested)) return p.requested;
  const own = [...new Set(p.staffLocationIds)].filter((id) => active.has(id));
  if (own.length === 1) return own[0];
  if (active.size === 1) return [...active][0];
  return null;
}

/**
 * The active location where `staffId` works at `start`, or null.
 * With `requested`, the staff member must have a shift at that location on the
 * day (split shifts and date overrides count). Without it, the location of the
 * shift that contains `start` wins, then the day's first shift.
 *
 * `allowOffShift` (override and series bookings only) falls back to
 * `pickFallbackLocation` when the day's shifts give no location, so staff can be
 * booked outside their normal availability. Public bookings never set it.
 */
export async function resolveBookingLocation(
  slug: string,
  staffId: string,
  start: Date,
  requested: string | null,
  opts: { allowOffShift?: boolean } = {},
): Promise<BookingLocation | null> {
  const settings = await loadSchedulingSettings(slug);
  const day = localDay(start, settings.timezone);
  const snap = await loadSchedulingSnapshot({
    slug,
    timezone: settings.timezone,
    staffIds: [staffId],
    fromDay: day,
    toDay: day,
    locationId: null,
    kinds: [],
  });
  const input = buildEngineInput(snap, day, {
    candidateStaffIds: [staffId],
    anyStaff: false,
    service: simpleServiceRequest(1),
    rules: buildRules(settings, start, { extraAdvanceDays: 0, allowFlex: false }),
  });
  const wins = staffWindows(input, staffId);
  const chosen = requested
    ? wins.some((w) => w.locationId === requested)
      ? requested
      : null
    : (wins.find((w) => w.start <= start && start < w.end) ?? wins[0])?.locationId ?? null;
  if (!chosen && !opts.allowOffShift) return null;

  return withTenantDb(slug, async (db, { locations, workingHours }) => {
    let target = chosen;
    if (!target) {
      const active = await db.select({ id: locations.id }).from(locations).where(eq(locations.isActive, 1));
      const own = await db
        .select({ id: workingHours.locationId })
        .from(workingHours)
        .where(and(eq(workingHours.staffId, staffId), eq(workingHours.isEnabled, 1)));
      target = pickFallbackLocation({
        requested,
        staffLocationIds: own.flatMap((r) => (r.id ? [r.id] : [])),
        activeLocationIds: active.map((r) => r.id),
      });
      if (!target) return null;
    }
    const [row] = await db
      .select({ id: locations.id, name: locations.name, address: locations.address })
      .from(locations)
      .where(and(eq(locations.id, target), eq(locations.isActive, 1)))
      .limit(1);
    return row ?? null;
  });
}
