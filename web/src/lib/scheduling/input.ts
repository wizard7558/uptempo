/**
 * Pure glue between a loaded `SchedulingSnapshot` and the engine's input.
 * No I/O: safe to unit test and to import anywhere.
 */
import { localDay, minutesUntilNextLocalMidnight, wallClockToDate } from "./intervals";
import type { SchedulingSettings, SchedulingSnapshot, ServiceNeedRow, ServiceTimingRow } from "./load";
import type { Busy, EngineInput, ResourceNeed, Rules, ServiceRequest, Travel, WeeklyHours } from "./types";

const MIN = 60_000;

/** Flex marker for a double-book row that has no parent (admin override). */
export const OVERRIDE_HOST = "__override__";

export function snapshotBusy(s: SchedulingSnapshot): Busy[] {
  const out: Busy[] = [];
  for (const a of s.appointments) {
    const busy: Busy = {
      staffId: a.staffId,
      kind: "appointment",
      appointmentId: a.id,
      interval: {
        start: new Date(a.start.getTime() - a.bufferBeforeMinutes * MIN),
        end: new Date(a.end.getTime() + a.bufferAfterMinutes * MIN),
      },
    };
    if (a.isDoubleBook) {
      busy.flexHostId = a.parentId ?? OVERRIDE_HOST;
    } else if (
      a.activeMinutes != null &&
      a.activeMinutes > 0 &&
      a.processingMinutes != null &&
      a.processingMinutes > 0 &&
      (s.locationId === null || a.locationId === s.locationId)
    ) {
      // The gap is measured from the unbuffered start.
      const gapStart = a.start.getTime() + a.activeMinutes * MIN;
      busy.processingGaps = [
        { start: new Date(gapStart), end: new Date(gapStart + a.processingMinutes * MIN) },
      ];
    }
    out.push(busy);
  }
  for (const b of s.timeBlocks) {
    out.push({ staffId: b.staffId, kind: "block", interval: { start: b.start, end: b.end } });
  }
  for (const e of s.external) {
    out.push({ staffId: e.staffId, kind: "external", interval: { start: e.start, end: e.end } });
  }
  for (const t of s.tasks) {
    out.push({ staffId: t.staffId, kind: "task", interval: { start: t.start, end: t.end } });
  }
  for (const u of s.resourceUses) {
    out.push({
      resourceId: u.resourceId,
      kind: "appointment",
      appointmentId: u.appointmentId,
      interval: { start: u.start, end: u.end },
    });
  }
  return out;
}

/** Number of non-cancelled appointments per staff member that start on `day`. */
export function dayLoadFor(s: SchedulingSnapshot, day: string): Record<string, number> {
  const load: Record<string, number> = {};
  for (const a of s.appointments) {
    if (localDay(a.start, s.timezone) === day) load[a.staffId] = (load[a.staffId] ?? 0) + 1;
  }
  return load;
}

export type RuleOptions = {
  extraAdvanceDays: number;
  allowFlex: boolean;
  timing?: {
    minNoticeMinutes: number | null;
    maxAdvanceDays: number | null;
    slotIntervalMinutes: number | null;
  };
};

export function buildRules(settings: SchedulingSettings, now: Date, o: RuleOptions): Rules {
  const base = o.timing?.minNoticeMinutes ?? settings.minNoticeMinutes;
  const minNotice = settings.sameDayBooking
    ? base
    : Math.max(base, minutesUntilNextLocalMidnight(now, settings.timezone));
  return {
    timezone: settings.timezone,
    now,
    minNoticeMinutes: minNotice,
    maxAdvanceDays: (o.timing?.maxAdvanceDays ?? settings.maxAdvanceDays) + o.extraAdvanceDays,
    slotIntervalMinutes: o.timing?.slotIntervalMinutes ?? settings.slotIntervalMinutes,
    allowFlex: o.allowFlex,
  };
}

export type EngineInputOptions = {
  candidateStaffIds: string[];
  anyStaff: boolean;
  service: ServiceRequest;
  rules: Rules;
  busy?: Busy[];
  /** Keep only busy items that touch `day` (default true). */
  clipToDay?: boolean;
  /** Travel inputs for an on-site job. Without them the engine rejects on-site slots with TRAVEL. */
  travel?: Travel;
};

export function buildEngineInput(
  s: SchedulingSnapshot,
  day: string,
  o: EngineInputOptions,
): EngineInput {
  const hours: WeeklyHours = s.hours.map((h) => ({
    staffId: h.staffId,
    dayOfWeek: h.dayOfWeek as WeeklyHours[number]["dayOfWeek"],
    start: h.startTime,
    end: h.endTime,
    locationId: h.locationId,
  }));
  let busy = o.busy ?? snapshotBusy(s);
  if (o.clipToDay !== false) {
    const ds = wallClockToDate(day, "00:00", s.timezone).getTime();
    const de = wallClockToDate(day, "24:00", s.timezone).getTime();
    busy = busy.filter(
      (b) => b.interval.start.getTime() < de && b.interval.end.getTime() > ds,
    );
  }
  return {
    day,
    candidateStaffIds: o.candidateStaffIds,
    anyStaff: o.anyStaff,
    hours,
    overrides: s.overrides,
    busy,
    resources: s.resources,
    service: o.service,
    rules: o.rules,
    dayLoad: dayLoadFor(s, day),
    ...(o.travel ? { travel: o.travel } : {}),
  };
}

/** Keeps only the neighbor jobs that touch local day `day`, so travel never chains across days. */
export function clipTravelToDay(travel: Travel, day: string, timezone: string): Travel {
  const ds = wallClockToDate(day, "00:00", timezone).getTime();
  const de = wallClockToDate(day, "24:00", timezone).getTime();
  return {
    ...travel,
    neighbors: travel.neighbors.filter(
      (n) => n.interval.start.getTime() < de && n.interval.end.getTime() > ds,
    ),
  };
}

export function simpleServiceRequest(totalMinutes: number): ServiceRequest {
  return {
    totalMinutes,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    resourceNeeds: [],
    locationType: "in_studio",
  };
}

export type RequestTiming = NonNullable<RuleOptions["timing"]>;

const maxOf = (xs: number[]) => (xs.length > 0 ? Math.max(...xs) : null);
const minOf = (xs: number[]) => (xs.length > 0 ? Math.min(...xs) : null);
const present = (xs: (number | null)[]) => xs.filter((x): x is number => x != null);

/**
 * Combines the timing of every chosen service into one engine request and one
 * set of rule overrides:
 * - buffers: the largest of the services
 * - minimum notice: the largest set value (the strictest), else null
 * - booking horizon and start-time grid: the smallest set value, else null
 * - resource needs: each need starts `offset_min` after the services listed
 *   before its own service, and lasts `duration_min` (null = its service's length)
 * - location type: "virtual" only when every service is virtual. "on_site" when `hasTravel`
 *   is true and any service is on-site; otherwise on-site services are treated as
 *   "in_studio" (no address yet, or the module is off), because an "on_site" request
 *   with no travel data would make the engine reject every slot with TRAVEL.
 */
export function buildServiceRequest(
  duration: { totalMinutes: number; services?: { serviceId: string; durationMinutes: number }[] },
  timing: ServiceTimingRow[],
  needs: ServiceNeedRow[] = [],
  hasTravel = false,
): { request: ServiceRequest; timing: RequestTiming } {
  const resourceNeeds: ResourceNeed[] = [];
  const lines = duration.services ?? [];
  for (const n of needs) {
    const k = lines.findIndex((l) => l.serviceId === n.serviceId);
    if (k < 0) continue;
    const before = lines.slice(0, k).reduce((sum, l) => sum + l.durationMinutes, 0);
    const need: ResourceNeed = {
      quantity: n.quantity,
      offsetMinutes: before + n.offsetMin,
      durationMinutes: n.durationMin ?? lines[k].durationMinutes,
    };
    if (n.resourceKind != null) need.kind = n.resourceKind;
    if (n.resourceId != null) need.resourceId = n.resourceId;
    resourceNeeds.push(need);
  }
  const anyOnSite = timing.some((t) => t.locationType === "on_site");
  const allVirtual = timing.length > 0 && timing.every((t) => t.locationType === "virtual");
  return {
    request: {
      totalMinutes: duration.totalMinutes,
      bufferBeforeMinutes: maxOf(timing.map((t) => t.bufferBeforeMin)) ?? 0,
      bufferAfterMinutes: maxOf(timing.map((t) => t.bufferAfterMin)) ?? 0,
      resourceNeeds,
      locationType: allVirtual ? "virtual" : hasTravel && anyOnSite ? "on_site" : "in_studio",
    },
    timing: {
      minNoticeMinutes: maxOf(present(timing.map((t) => t.minNoticeMin))),
      maxAdvanceDays: minOf(present(timing.map((t) => t.maxAdvanceDays))),
      slotIntervalMinutes: minOf(present(timing.map((t) => t.slotIntervalMin))),
    },
  };
}
