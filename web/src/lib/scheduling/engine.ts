import { dayOfWeekOf, daysBetween, localDay, wallClockToDate } from "./intervals";
import { estimateTravelMinutes } from "./travel";
import type {
  Busy,
  EngineInput,
  Interval,
  RejectReason,
  Resource,
  Slot,
} from "./types";

const MIN = 60_000;
/** Arrival window shown for on-site jobs when the business has not chosen one. */
const DEFAULT_ARRIVAL_WINDOW_MINUTES = 120;

const REASON_ORDER: RejectReason[] = [
  "CLOSED_DAY",
  "OUTSIDE_HOURS",
  "BUSY_APPOINTMENT",
  "BUSY_BLOCK",
  "BUSY_EXTERNAL",
  "BUSY_CLASS",
  "RESOURCE_UNAVAILABLE",
  "TOO_SOON",
  "TOO_FAR",
  "TRAVEL",
  "WINDOW_CLOSED",
];

/** "task" has no dedicated reason; it blocks the calendar like a block. */
const BUSY_REASON: Record<Busy["kind"], RejectReason> = {
  appointment: "BUSY_APPOINTMENT",
  block: "BUSY_BLOCK",
  external: "BUSY_EXTERNAL",
  class: "BUSY_CLASS",
  task: "BUSY_BLOCK",
};

type Entry = { busy: Busy; s: number; e: number };
type Window = { s: number; e: number; locationId: string | null };
type Host = { entry: Entry; gaps: { s: number; e: number }[] };

type Ctx = {
  input: EngineInput;
  staffOrder: string[];
  windows: Map<string, Window[]>;
  busyByStaff: Map<string, Entry[]>;
  busyByResource: Map<string, Entry[]>;
  hostsByStaff: Map<string, Host[]>;
  resourceById: Map<string, Resource>;
  totalMs: number;
  bbMs: number;
  baMs: number;
  stepMs: number;
  nowMs: number;
  noticeMs: number;
  tooFar: boolean;
};

type Evaluation = { reasons: RejectReason[]; slot?: Slot };

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function buildWindows(input: EngineInput, staffId: string): Window[] {
  const { day, rules } = input;
  let raw: { start: string; end: string; locationId: string | null }[];
  // The last override for a staff/date wins. An empty list means closed.
  let override: (typeof input.overrides)[number] | undefined;
  for (const o of input.overrides) {
    if (o.staffId === staffId && o.date === day) override = o;
  }
  if (override) {
    raw = override.intervals;
  } else {
    const dow = dayOfWeekOf(day);
    raw = input.hours.filter((h) => h.staffId === staffId && h.dayOfWeek === dow);
  }
  const wins: Window[] = [];
  for (const r of raw) {
    const s = wallClockToDate(day, r.start, rules.timezone).getTime();
    const e = wallClockToDate(day, r.end, rules.timezone).getTime();
    if (e > s) wins.push({ s, e, locationId: r.locationId });
  }
  wins.sort((a, b) => a.s - b.s || a.e - b.e);
  // Merge overlapping or touching windows at the same location.
  const merged: Window[] = [];
  for (const w of wins) {
    const last = merged[merged.length - 1];
    if (last && last.locationId === w.locationId && w.s <= last.e) {
      last.e = Math.max(last.e, w.e);
    } else {
      merged.push({ ...w });
    }
  }
  return merged;
}

/**
 * The working windows (after overrides) of one staff member on `input.day`, as
 * instants with their location. Empty = closed. Use it to find where a staff
 * member works at a given time.
 */
export function staffWindows(
  input: EngineInput,
  staffId: string,
): { start: Date; end: Date; locationId: string | null }[] {
  return buildWindows(input, staffId).map((w) => ({
    start: new Date(w.s),
    end: new Date(w.e),
    locationId: w.locationId,
  }));
}

function prepare(input: EngineInput, extraStaffId?: string): Ctx {
  const staffOrder: string[] = [];
  for (const id of input.candidateStaffIds) if (!staffOrder.includes(id)) staffOrder.push(id);
  if (extraStaffId !== undefined && !staffOrder.includes(extraStaffId)) staffOrder.push(extraStaffId);

  const busyByStaff = new Map<string, Entry[]>();
  const busyByResource = new Map<string, Entry[]>();
  for (const busy of input.busy) {
    const entry: Entry = {
      busy,
      s: busy.interval.start.getTime(),
      e: busy.interval.end.getTime(),
    };
    if (busy.staffId !== undefined) push(busyByStaff, busy.staffId, entry);
    if (busy.resourceId !== undefined) push(busyByResource, busy.resourceId, entry);
  }

  const hostsByStaff = new Map<string, Host[]>();
  for (const [staffId, entries] of busyByStaff) {
    const childOf = new Set<string>();
    for (const en of entries) if (en.busy.flexHostId !== undefined) childOf.add(en.busy.flexHostId);
    for (const en of entries) {
      const b = en.busy;
      if (
        b.kind !== "appointment" ||
        b.flexHostId !== undefined ||
        b.appointmentId === undefined ||
        !b.processingGaps?.length ||
        childOf.has(b.appointmentId) // legacy: at most one flex child per host
      ) {
        continue;
      }
      push(hostsByStaff, staffId, {
        entry: en,
        gaps: b.processingGaps.map((g) => ({ s: g.start.getTime(), e: g.end.getTime() })),
      });
    }
  }

  const windows = new Map<string, Window[]>();
  for (const id of staffOrder) windows.set(id, buildWindows(input, id));

  const { rules, service } = input;
  const dayDiff = daysBetween(localDay(rules.now, rules.timezone), input.day);

  return {
    input,
    staffOrder,
    windows,
    busyByStaff,
    busyByResource,
    hostsByStaff,
    resourceById: new Map(input.resources.map((r) => [r.id, r])),
    totalMs: service.totalMinutes * MIN,
    bbMs: service.bufferBeforeMinutes * MIN,
    baMs: service.bufferAfterMinutes * MIN,
    stepMs: Math.max(1, rules.slotIntervalMinutes) * MIN,
    nowMs: rules.now.getTime(),
    noticeMs: rules.minNoticeMinutes * MIN,
    tooFar: dayDiff > rules.maxAdvanceDays,
  };
}

type Pick = { id: string; s: number; e: number };

/** Peak concurrent use of a resource inside [ws, we) is below its capacity. */
function hasRoom(ctx: Ctx, r: Resource, ws: number, we: number): boolean {
  const items = (ctx.busyByResource.get(r.id) ?? []).filter((it) => it.s < we && it.e > ws);
  if (items.length < r.capacity) return true;
  for (const p of [ws, ...items.map((it) => it.s).filter((s) => s > ws && s < we)]) {
    let c = 0;
    for (const it of items) if (it.s <= p && p < it.e) c++;
    if (c >= r.capacity) return false;
  }
  return true;
}

function pickResources(
  ctx: Ctx,
  startMs: number,
  location: string | null,
): Pick[] | null {
  const needs = ctx.input.service.resourceNeeds;
  if (needs.length === 0) return [];
  const used = new Set<string>();
  const picked: Pick[] = [];
  const ordered = [
    ...needs.filter((n) => n.resourceId !== undefined),
    ...needs.filter((n) => n.resourceId === undefined),
  ];
  for (const need of ordered) {
    const ws = startMs + need.offsetMinutes * MIN;
    const we = ws + (need.durationMinutes ?? ctx.input.service.totalMinutes) * MIN;
    const isFree = (r: Resource) => hasRoom(ctx, r, ws, we);
    let candidates: Resource[];
    let quantity = need.quantity;
    if (need.resourceId !== undefined) {
      const r = ctx.resourceById.get(need.resourceId);
      candidates = r ? [r] : [];
      quantity = 1;
    } else if (need.kind !== undefined) {
      candidates = ctx.input.resources
        .filter(
          (r) =>
            r.kind === need.kind &&
            (r.locationId === null || location === null || r.locationId === location),
        )
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    } else {
      return null;
    }
    let got = 0;
    for (const r of candidates) {
      if (got >= quantity) break;
      if (used.has(r.id) || !isFree(r)) continue;
      used.add(r.id);
      picked.push({ id: r.id, s: ws, e: we });
      got++;
    }
    if (got < quantity) return null;
  }
  return picked;
}

type TravelResult = { ok: boolean; beforeMinutes?: number };

function checkTravel(ctx: Ctx, staffId: string, oS: number, oE: number): TravelResult {
  const travel = ctx.input.travel;
  const base = travel?.staffBase[staffId];
  if (!travel || !base) return { ok: false };
  let prev: { point: typeof base; e: number } | undefined;
  let next: { point: typeof base; s: number } | undefined;
  for (const n of travel.neighbors) {
    if (n.staffId !== staffId) continue;
    const ns = n.interval.start.getTime();
    const ne = n.interval.end.getTime();
    if (ns < oE && ne > oS) return { ok: false }; // neighbor job overlaps the span
    if (ne <= oS && (!prev || ne > prev.e)) prev = { point: n.point as typeof base, e: ne };
    if (ns >= oE && (!next || ns < next.s)) next = { point: n.point as typeof base, s: ns };
  }
  const from = prev ? prev.point : base;
  const before = estimateTravelMinutes(from, travel.jobPoint, base.speedKmh);
  if (before > base.maxTravelMinutes) return { ok: false };
  const buffer = base.bufferMinutes ?? 0;
  if (prev && oS - prev.e < (before + buffer) * MIN) return { ok: false };
  if (next) {
    const after = estimateTravelMinutes(travel.jobPoint, next.point, base.speedKmh);
    if (after > base.maxTravelMinutes) return { ok: false };
    if (next.s - oE < (after + buffer) * MIN) return { ok: false };
  }
  return { ok: true, beforeMinutes: before };
}

function evaluate(ctx: Ctx, staffId: string, startMs: number): Evaluation {
  const reasons = new Set<RejectReason>();
  const { input } = ctx;
  const endMs = startMs + ctx.totalMs;
  const oS = startMs - ctx.bbMs;
  const oE = endMs + ctx.baMs;

  // Working hours
  const wins = ctx.windows.get(staffId) ?? [];
  let location: string | null = null;
  if (wins.length === 0) {
    reasons.add("CLOSED_DAY");
  } else {
    const inside = wins.find((w) => w.s <= oS && oE <= w.e);
    if (inside) {
      location = inside.locationId;
    } else {
      reasons.add("OUTSIDE_HOURS");
      const at = wins.find((w) => w.s <= startMs && startMs < w.e);
      if (at) location = at.locationId;
    }
  }

  // Staff busy items
  const conflicts = (ctx.busyByStaff.get(staffId) ?? []).filter((en) => en.s < oE && en.e > oS);
  let hostId: string | undefined;
  if (conflicts.length > 0) {
    let flexOk = false;
    if (input.rules.allowFlex) {
      for (const host of ctx.hostsByStaff.get(staffId) ?? []) {
        const gap = host.gaps.find((g) => g.s === startMs && endMs <= g.e);
        if (!gap) continue;
        const only = conflicts.every(
          (en) =>
            en.busy.kind === "appointment" &&
            (en === host.entry || en.busy.flexHostId !== undefined),
        );
        if (only) {
          flexOk = true;
          hostId = host.entry.busy.appointmentId;
          break;
        }
      }
    }
    if (!flexOk) for (const en of conflicts) reasons.add(BUSY_REASON[en.busy.kind]);
  }

  // Resources
  const picks = pickResources(ctx, startMs, location);
  if (picks === null) reasons.add("RESOURCE_UNAVAILABLE");

  // Notice and horizon
  if (startMs < ctx.nowMs + ctx.noticeMs) reasons.add("TOO_SOON");
  if (ctx.tooFar) reasons.add("TOO_FAR");

  // Booking windows
  const bw = input.rules.bookingWindows?.[staffId];
  if (bw && !bw.some((w) => w.opensAt.getTime() <= startMs && startMs < w.closesAt.getTime())) {
    reasons.add("WINDOW_CLOSED");
  }

  // Travel
  let travelBefore: number | undefined;
  const onSite = input.service.locationType === "on_site";
  if (onSite) {
    const t = checkTravel(ctx, staffId, oS, oE);
    if (t.ok) travelBefore = t.beforeMinutes;
    else reasons.add("TRAVEL");
  }

  const sorted = REASON_ORDER.filter((r) => reasons.has(r));
  if (sorted.length > 0 || picks === null) return { reasons: sorted };

  const slot: Slot = {
    start: new Date(startMs),
    end: new Date(endMs),
    staffId,
    resourceIds: picks.map((p) => p.id),
    isFlex: hostId !== undefined,
    locationId: location,
  };
  if (picks.length > 0) {
    slot.resourceAssignments = picks.map((p) => ({
      resourceId: p.id,
      interval: { start: new Date(p.s), end: new Date(p.e) },
    }));
  }
  if (hostId !== undefined) slot.hostAppointmentId = hostId;
  if (onSite) {
    slot.travelBeforeMinutes = travelBefore;
    const winMs = (input.travel?.arrivalWindowMinutes ?? DEFAULT_ARRIVAL_WINDOW_MINUTES) * MIN;
    if (winMs > 0) {
      slot.arrivalWindow = { start: new Date(startMs), end: new Date(startMs + winMs) };
    }
  }
  return { reasons: [], slot };
}

function candidateStarts(ctx: Ctx, staffId: string): number[] {
  const starts = new Set<number>();
  const wins = ctx.windows.get(staffId) ?? [];
  const fits = (s: number) =>
    wins.some((w) => w.s <= s - ctx.bbMs && s + ctx.totalMs + ctx.baMs <= w.e);
  for (const w of wins) {
    for (let t = w.s; t + ctx.totalMs + ctx.baMs <= w.e; t += ctx.stepMs) {
      if (t - ctx.bbMs >= w.s) starts.add(t);
    }
  }
  if (ctx.input.rules.allowFlex) {
    // Legacy: flex is offered only at the start of the host's processing window.
    for (const host of ctx.hostsByStaff.get(staffId) ?? []) {
      for (const g of host.gaps) if (fits(g.s)) starts.add(g.s);
    }
  }
  return [...starts].sort((a, b) => a - b);
}

/**
 * Compute every bookable slot for `input.day`. Pure: same input, same output.
 * Output is sorted by start, then by candidate staff order.
 */
export function computeSlots(input: EngineInput): Slot[] {
  const ctx = prepare(input);
  const found: { slot: Slot; order: number }[] = [];
  ctx.staffOrder.forEach((staffId, order) => {
    for (const s of candidateStarts(ctx, staffId)) {
      const r = evaluate(ctx, staffId, s);
      if (r.slot) found.push({ slot: r.slot, order });
    }
  });

  let chosen = found;
  if (input.anyStaff) {
    // One slot per start: lowest dayLoad wins, ties go to candidate order.
    const best = new Map<number, { slot: Slot; order: number }>();
    for (const f of found) {
      const key = f.slot.start.getTime();
      const cur = best.get(key);
      if (!cur) {
        best.set(key, f);
        continue;
      }
      const lf = input.dayLoad?.[f.slot.staffId] ?? 0;
      const lc = input.dayLoad?.[cur.slot.staffId] ?? 0;
      if (lf < lc || (lf === lc && f.order < cur.order)) best.set(key, f);
    }
    chosen = [...best.values()];
  }

  chosen.sort((a, b) => a.slot.start.getTime() - b.slot.start.getTime() || a.order - b.order);
  return chosen.map((c) => c.slot);
}

/**
 * Every reason `start` is not bookable for `staffId` (empty = bookable).
 * Uses the same evaluation as `computeSlots`, so the two always agree.
 * It does not apply the any-staff pick: it reports on this staff member only.
 */
export function explainSlot(input: EngineInput, start: Date, staffId: string): RejectReason[] {
  const ctx = prepare(input, staffId);
  return evaluate(ctx, staffId, start.getTime()).reasons;
}

/**
 * `explainSlot` plus the slot itself when nothing rejects it. The slot carries
 * the chosen resources (`resourceAssignments`).
 */
export function evaluateStart(
  input: EngineInput,
  start: Date,
  staffId: string,
): { reasons: RejectReason[]; slot?: Slot } {
  const ctx = prepare(input, staffId);
  return evaluate(ctx, staffId, start.getTime());
}

/**
 * The resources a booking at `start` would hold, ignoring every other rule
 * (hours, notice, busy staff). Used by admin overrides and reschedules, which
 * skip some rules but still need free resources. null = something it needs is taken.
 */
export function pickResourcesAt(
  input: EngineInput,
  start: Date,
  locationId: string | null,
): { resourceId: string; interval: Interval }[] | null {
  const ctx = prepare(input);
  const picks = pickResources(ctx, start.getTime(), locationId);
  if (picks === null) return null;
  return picks.map((p) => ({
    resourceId: p.id,
    interval: { start: new Date(p.s), end: new Date(p.e) },
  }));
}
