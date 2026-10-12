import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { computeSlots, explainSlot } from "./engine";
import { daysBetween, localDay, wallClockToDate } from "./intervals";
import { TZ, weekly } from "./testing";
import type { Busy, EngineInput, Resource } from "./types";

vi.setConfig({ testTimeout: 120_000 }); // soak runs (FC_RUNS) can be long
const MIN = 60_000;
const STAFF_IDS = ["s1", "s2", "s3"];
const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// ---- generators ----------------------------------------------------------

const dayArb = fc.constantFrom("2026-06-17", "2026-03-08", "2026-11-01", "2026-01-14");

/** Up to two working intervals separated by >= 30 minutes (so the engine never merges them). */
const hoursArb = fc
  .tuple(
    fc.integer({ min: 0, max: 200 }),
    fc.integer({ min: 3, max: 60 }),
    fc.integer({ min: 6, max: 40 }),
    fc.integer({ min: 3, max: 60 }),
    fc.boolean(),
    fc.constantFrom<string | null>(null, "L1", "L2"),
    fc.constantFrom<string | null>(null, "L1", "L2"),
  )
  .map(([s1, l1, gap, l2, two, loc1, loc2]) => {
    const out: { start: number; end: number; loc: string | null }[] = [];
    const e1 = Math.min(288, s1 + l1);
    out.push({ start: s1 * 5, end: e1 * 5, loc: loc1 });
    const s2 = e1 + gap;
    if (two && s2 < 288) out.push({ start: s2 * 5, end: Math.min(288, s2 + l2) * 5, loc: loc2 });
    return out;
  });

const scenarioArb = fc.record({
  day: dayArb,
  staffCount: fc.integer({ min: 1, max: 3 }),
  anyStaff: fc.boolean(),
  staffHours: fc.array(fc.option(hoursArb, { nil: undefined }), { minLength: 3, maxLength: 3 }),
  total: fc.integer({ min: 1, max: 36 }).map((u) => u * 5),
  before: fc.constantFrom(0, 0, 5, 15),
  after: fc.constantFrom(0, 0, 5, 15, 30),
  interval: fc.constantFrom(5, 15, 15, 30),
  busyRaw: fc.array(
    fc.record({
      staff: fc.integer({ min: 0, max: 2 }),
      start: fc.integer({ min: 0, max: 280 }),
      len: fc.integer({ min: 0, max: 30 }),
      kind: fc.constantFrom<Busy["kind"]>("appointment", "appointment", "block", "external", "class", "task"),
      gap: fc.option(fc.tuple(fc.integer({ min: 0, max: 20 }), fc.integer({ min: 1, max: 20 })), { nil: undefined }),
      child: fc.boolean(),
    }),
    { maxLength: 14 },
  ),
  resourceBusy: fc.array(
    fc.record({
      res: fc.integer({ min: 0, max: 3 }),
      start: fc.integer({ min: 0, max: 280 }),
      len: fc.integer({ min: 1, max: 30 }),
    }),
    { maxLength: 6 },
  ),
  resourceLocs: fc.array(fc.constantFrom<string | null>(null, "L1", "L2"), { minLength: 4, maxLength: 4 }),
  needs: fc.array(
    fc.record({
      kind: fc.constantFrom("room", "chair"),
      quantity: fc.integer({ min: 1, max: 2 }),
      offset: fc.integer({ min: 0, max: 6 }),
      duration: fc.option(fc.integer({ min: 1, max: 12 }), { nil: null }),
    }),
    { maxLength: 2 },
  ),
  nowBackMinutes: fc.integer({ min: -600, max: 4000 }),
  minNotice: fc.constantFrom(0, 0, 30, 120, 600),
  maxAdvance: fc.integer({ min: 0, max: 4 }),
  allowFlex: fc.boolean(),
  windows: fc.array(
    fc.option(
      fc.array(fc.tuple(fc.integer({ min: 0, max: 280 }), fc.integer({ min: 1, max: 120 })), { maxLength: 2 }),
      { nil: undefined },
    ),
    { minLength: 3, maxLength: 3 },
  ),
  load: fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 3, maxLength: 3 }),
});

type Scenario = typeof scenarioArb extends fc.Arbitrary<infer T> ? T : never;

function build(sc: Scenario): { input: EngineInput; grid: Map<string, number[]> } {
  const staff = STAFF_IDS.slice(0, sc.staffCount);
  const day = sc.day;
  const dayStart = wallClockToDate(day, "00:00", TZ).getTime();
  const wall = (m: number) => wallClockToDate(day, hhmm(m), TZ).getTime();

  const hours = staff.flatMap((id, i) =>
    (sc.staffHours[i] ?? []).flatMap((h) =>
      weekly(id, hhmm(h.start), hhmm(h.end), h.loc),
    ),
  );

  const busy: Busy[] = [];
  sc.busyRaw.forEach((b, i) => {
    const s = wall(b.start * 5);
    const e = s + b.len * 5 * MIN;
    const item: Busy = {
      staffId: STAFF_IDS[b.staff],
      kind: b.kind,
      interval: { start: new Date(s), end: new Date(e) },
    };
    if (b.kind === "appointment") {
      item.appointmentId = `a${i}`;
      if (b.gap) {
        const gs = s + b.gap[0] * 5 * MIN;
        item.processingGaps = [{ start: new Date(gs), end: new Date(gs + b.gap[1] * 5 * MIN) }];
      }
      if (b.child && i > 0) item.flexHostId = `a${i - 1}`;
    }
    busy.push(item);
  });
  for (const rb of sc.resourceBusy) {
    const s = wall(rb.start * 5);
    busy.push({
      resourceId: `r${rb.res + 1}`,
      kind: "block",
      interval: { start: new Date(s), end: new Date(s + rb.len * 5 * MIN) },
    });
  }

  const resources: Resource[] = [0, 1, 2, 3].map((i) => ({
    id: `r${i + 1}`,
    kind: i % 2 === 0 ? "room" : "chair",
    locationId: sc.resourceLocs[i],
    capacity: 1,
  }));

  const bookingWindows: NonNullable<EngineInput["rules"]["bookingWindows"]> = {};
  staff.forEach((id, i) => {
    const w = sc.windows[i];
    if (w) {
      bookingWindows[id] = w.map(([s, l]) => ({
        opensAt: new Date(wall(s * 5)),
        closesAt: new Date(wall(s * 5) + l * 5 * MIN),
      }));
    }
  });

  const input: EngineInput = {
    day,
    candidateStaffIds: staff,
    anyStaff: sc.anyStaff,
    hours,
    overrides: [],
    busy,
    resources,
    service: {
      totalMinutes: sc.total,
      bufferBeforeMinutes: sc.before,
      bufferAfterMinutes: sc.after,
      resourceNeeds: sc.needs.map((n) => ({
        kind: n.kind,
        quantity: n.quantity,
        offsetMinutes: n.offset * 5,
        durationMinutes: n.duration === null ? null : n.duration * 5,
      })),
      locationType: "in_studio",
    },
    rules: {
      timezone: TZ,
      now: new Date(dayStart - sc.nowBackMinutes * MIN),
      minNoticeMinutes: sc.minNotice,
      maxAdvanceDays: sc.maxAdvance,
      slotIntervalMinutes: sc.interval,
      allowFlex: sc.allowFlex,
      ...(Object.keys(bookingWindows).length ? { bookingWindows } : {}),
    },
    dayLoad: Object.fromEntries(staff.map((id, i) => [id, sc.load[i]])),
  };

  // Grid points: every interval-relative step, including ones that do not fit.
  const grid = new Map<string, number[]>();
  for (const id of staff) {
    const pts: number[] = [];
    const wins = windowsOf(input, id);
    const fitsIn = (w: { s: number; e: number }, t: number) =>
      w.s <= t - sc.before * MIN && t + (sc.total + sc.after) * MIN <= w.e;
    for (const w of wins) {
      for (let t = w.s; t <= w.e; t += sc.interval * MIN) {
        // The engine anchors each window's grid at that window's own start. DST can make
        // generated windows at different locations overlap (01:55-02:10 on spring-forward
        // day resolves to 01:55-03:10, colliding with a 03:00 window). A point that does
        // not fit its own window but fits another one off that window's grid is not a
        // grid start at all, so it is not asserted.
        if (fitsIn(w, t) || !wins.some((o) => fitsIn(o, t))) pts.push(t);
      }
    }
    grid.set(id, pts);
  }
  return { input, grid };
}

// FC_RUNS lets you soak locally (e.g. FC_RUNS=5000); CI default is 400 per property.
const RUNS = { numRuns: Number(process.env.FC_RUNS ?? 400) };

/**
 * Working windows of a staff member for the day, independently of the engine.
 * Overlapping or touching windows at the same location are merged (DST can make
 * generated wall-clock intervals collide, e.g. 02:15 does not exist on spring-forward day).
 */
function windowsOf(input: EngineInput, staffId: string) {
  const raw = input.hours
    .filter((h) => h.staffId === staffId)
    .map((h) => ({
      s: wallClockToDate(input.day, h.start, TZ).getTime(),
      e: wallClockToDate(input.day, h.end, TZ).getTime(),
      loc: h.locationId,
    }))
    .filter((w) => w.e > w.s)
    .sort((a, b) => a.s - b.s || a.e - b.e);
  const out: typeof raw = [];
  for (const w of raw) {
    const last = out[out.length - 1];
    if (last && last.loc === w.loc && w.s <= last.e) last.e = Math.max(last.e, w.e);
    else out.push({ ...w });
  }
  return out;
}

describe("engine properties", () => {
  it("every slot is inside working hours including buffers", () => {
    fc.assert(
      fc.property(scenarioArb, (sc) => {
        const { input } = build(sc);
        for (const slot of computeSlots(input)) {
          const o0 = slot.start.getTime() - sc.before * MIN;
          const o1 = slot.end.getTime() + sc.after * MIN;
          expect(slot.end.getTime() - slot.start.getTime()).toBe(sc.total * MIN);
          expect(windowsOf(input, slot.staffId).some((w) => w.s <= o0 && o1 <= w.e)).toBe(true);
        }
      }),
      RUNS,
    );
  });

  it("no slot overlaps staff busy items, except flex inside a processing gap", () => {
    fc.assert(
      fc.property(scenarioArb, (sc) => {
        const { input } = build(sc);
        for (const slot of computeSlots(input)) {
          const o0 = slot.start.getTime() - sc.before * MIN;
          const o1 = slot.end.getTime() + sc.after * MIN;
          const hits = input.busy.filter(
            (b) =>
              b.staffId === slot.staffId &&
              b.interval.start.getTime() < o1 &&
              b.interval.end.getTime() > o0,
          );
          if (!slot.isFlex) {
            expect(hits).toEqual([]);
            expect(slot.hostAppointmentId).toBeUndefined();
            continue;
          }
          expect(input.rules.allowFlex).toBe(true);
          const host = input.busy.find((b) => b.appointmentId === slot.hostAppointmentId);
          expect(host?.staffId).toBe(slot.staffId);
          expect(
            host!.processingGaps!.some(
              (g) =>
                g.start.getTime() === slot.start.getTime() &&
                slot.end.getTime() <= g.end.getTime(),
            ),
          ).toBe(true);
          // at most one flex child per host
          expect(input.busy.some((b) => b.flexHostId === slot.hostAppointmentId && b.staffId === slot.staffId)).toBe(false);
          for (const h of hits) {
            expect(h === host || h.flexHostId !== undefined).toBe(true);
            expect(h.kind).toBe("appointment");
          }
        }
      }),
      RUNS,
    );
  });

  it("resources are free in their sub-windows, distinct, and match the need counts", () => {
    fc.assert(
      fc.property(scenarioArb, (sc) => {
        const { input } = build(sc);
        const needs = input.service.resourceNeeds;
        const total = needs.reduce((n, x) => n + x.quantity, 0);
        for (const slot of computeSlots(input)) {
          expect(slot.resourceIds).toHaveLength(total);
          expect(new Set(slot.resourceIds).size).toBe(total);
          let i = 0;
          for (const need of needs) {
            const ws = slot.start.getTime() + need.offsetMinutes * MIN;
            const we = ws + (need.durationMinutes ?? input.service.totalMinutes) * MIN;
            for (let q = 0; q < need.quantity; q++) {
              const id = slot.resourceIds[i++];
              const res = input.resources.find((r) => r.id === id)!;
              expect(res.kind).toBe(need.kind);
              if (res.locationId !== null && slot.locationId !== null) {
                expect(res.locationId).toBe(slot.locationId);
              }
              const clash = input.busy.some(
                (b) =>
                  b.resourceId === id &&
                  b.interval.start.getTime() < we &&
                  b.interval.end.getTime() > ws,
              );
              expect(clash).toBe(false);
            }
          }
        }
      }),
      RUNS,
    );
  });

  it("respects minimum notice, advance horizon and booking windows", () => {
    fc.assert(
      fc.property(scenarioArb, (sc) => {
        const { input } = build(sc);
        const slots = computeSlots(input);
        const { now, minNoticeMinutes, maxAdvanceDays, bookingWindows } = input.rules;
        for (const slot of slots) {
          expect(slot.start.getTime()).toBeGreaterThanOrEqual(now.getTime() + minNoticeMinutes * MIN);
          expect(daysBetween(localDay(now, TZ), input.day)).toBeLessThanOrEqual(maxAdvanceDays);
          const w = bookingWindows?.[slot.staffId];
          if (w) {
            expect(
              w.some((x) => x.opensAt.getTime() <= slot.start.getTime() && slot.start.getTime() < x.closesAt.getTime()),
            ).toBe(true);
          }
        }
      }),
      RUNS,
    );
  });

  it("output is sorted by start, then staff order; any-staff yields unique starts", () => {
    fc.assert(
      fc.property(scenarioArb, (sc) => {
        const { input } = build(sc);
        const slots = computeSlots(input);
        for (let i = 1; i < slots.length; i++) {
          const a = slots[i - 1];
          const b = slots[i];
          const ta = a.start.getTime();
          const tb = b.start.getTime();
          expect(ta).toBeLessThanOrEqual(tb);
          if (ta === tb) {
            expect(input.candidateStaffIds.indexOf(a.staffId)).toBeLessThan(
              input.candidateStaffIds.indexOf(b.staffId),
            );
          }
          if (input.anyStaff) expect(ta).not.toBe(tb);
        }
      }),
      RUNS,
    );
  });

  it("explainSlot is [] for every returned slot", () => {
    fc.assert(
      fc.property(scenarioArb, (sc) => {
        const { input } = build(sc);
        for (const slot of computeSlots(input)) {
          expect(explainSlot(input, slot.start, slot.staffId)).toEqual([]);
        }
      }),
      RUNS,
    );
  });

  it("grid starts are returned iff explainSlot is [] (any-staff: lowest load wins)", () => {
    fc.assert(
      fc.property(scenarioArb, (sc) => {
        const { input, grid } = build(sc);
        const slots = computeSlots(input);
        const returned = new Set(slots.map((s) => `${s.staffId}@${s.start.getTime()}`));
        const byStart = new Map<number, string[]>();
        for (const s of slots) {
          const l = byStart.get(s.start.getTime()) ?? [];
          l.push(s.staffId);
          byStart.set(s.start.getTime(), l);
        }
        const gapStarts = new Set<number>();
        for (const b of input.busy) for (const g of b.processingGaps ?? []) gapStarts.add(g.start.getTime());

        const starts = new Set<number>();
        for (const pts of grid.values()) pts.forEach((p) => starts.add(p));
        for (const t of starts) {
          if (input.rules.allowFlex && gapStarts.has(t)) continue; // flex anchors are not grid-driven
          const onGrid = (id: string) => (grid.get(id) ?? []).includes(t);
          const bookable = (id: string) => explainSlot(input, new Date(t), id).length === 0;
          if (!input.anyStaff) {
            for (const id of input.candidateStaffIds) {
              if (onGrid(id)) expect(returned.has(`${id}@${t}`)).toBe(bookable(id));
            }
            continue;
          }
          const eligible = input.candidateStaffIds.filter((id) => onGrid(id) && bookable(id));
          const got = byStart.get(t) ?? [];
          if (eligible.length === 0) {
            expect(got).toEqual([]);
          } else {
            const load = (id: string) => input.dayLoad?.[id] ?? 0;
            const best = [...eligible].sort(
              (x, y) => load(x) - load(y) || input.candidateStaffIds.indexOf(x) - input.candidateStaffIds.indexOf(y),
            )[0];
            expect(got).toEqual([best]);
          }
        }
      }),
      RUNS,
    );
  });

  it("is deterministic and does not mutate its input", () => {
    fc.assert(
      fc.property(scenarioArb, (sc) => {
        const { input } = build(sc);
        const before = JSON.stringify(input);
        const a = computeSlots(input);
        const b = computeSlots(input);
        expect(JSON.stringify(input)).toBe(before);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      }),
      RUNS,
    );
  });
});
