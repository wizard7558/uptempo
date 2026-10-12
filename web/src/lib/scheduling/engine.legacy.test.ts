/**
 * Equivalence of the new engine with today's availability behavior.
 *
 * The legacy functions under test are the pure ones: `generateSlots`,
 * `findAvailableStartTimes` (slot-fitting) and `findProcessingGaps`. The DB-backed
 * wrapper `getAvailableSlots` in `src/actions/booking-public.ts` is mirrored by
 * `legacyPublicStarts` below (a verbatim copy of its pure filtering logic).
 *
 * Intentional differences (the engine is the corrected behavior) are marked
 * "LEGACY DIFFERENCE" in the test name:
 *  1. Time blocks are never excluded from the displayed slots on the legacy public
 *     path (they are only checked at confirm time); the engine excludes them.
 *  2. Legacy requires ceil(total/15) free 15-minute sub-slots, so a duration that is
 *     not a multiple of 15 over-blocks; the engine checks the exact span.
 *  3. Legacy flex ignores time blocks, external events, and classes; the engine
 *     treats them as blocking.
 *  4. Legacy flex does not require the flex span to be inside working hours; the
 *     engine does.
 */
import { TZDate } from "@date-fns/tz";
import { addMinutes } from "date-fns";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  findAvailableStartTimes,
  findProcessingGaps,
  generateSlots,
  type ScheduledAppointment,
  type TimeSlot,
  type WorkingHoursConfig,
} from "./legacy-oracle";
import { computeSlots } from "./engine";
import { dayOfWeekOf } from "./intervals";
import type { Busy, EngineInput } from "./types";

const STAFF = "s";

function legacyRules(tz: string): EngineInput["rules"] {
  return {
    timezone: tz,
    now: new Date("2000-01-01T00:00:00Z"),
    minNoticeMinutes: 0,
    maxAdvanceDays: 100_000,
    slotIntervalMinutes: 15,
    allowFlex: true,
  };
}

function engineInput(opts: {
  day: string;
  tz: string;
  start: string;
  end: string;
  busy?: Busy[];
  total: number;
  interval?: number;
  enabled?: boolean;
  flex?: boolean;
}): EngineInput {
  const dow = dayOfWeekOf(opts.day);
  return {
    day: opts.day,
    candidateStaffIds: [STAFF],
    anyStaff: false,
    hours:
      opts.enabled === false
        ? []
        : [{ staffId: STAFF, dayOfWeek: dow, start: opts.start, end: opts.end, locationId: null }],
    overrides: [],
    busy: opts.busy ?? [],
    resources: [],
    service: {
      totalMinutes: opts.total,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      resourceNeeds: [],
      locationType: "in_studio",
    },
    rules: {
      ...legacyRules(opts.tz),
      slotIntervalMinutes: opts.interval ?? 15,
      allowFlex: opts.flex ?? true,
    },
  };
}

const toBusy = (slots: TimeSlot[]): Busy[] =>
  slots.map((s) => ({ staffId: STAFF, interval: { start: s.start, end: s.end }, kind: "appointment" }));

const ms = (ds: Date[]) => ds.map((d) => d.getTime());

/** Verbatim pure part of booking-public.ts getAvailableSlots (non-flex entries). */
function legacyPublicStarts(
  day: string,
  tz: string,
  wh: WorkingHoursConfig,
  appts: TimeSlot[],
  total: number,
): number[] {
  const [y, m, d] = day.split("-").map(Number);
  const dateObj = new TZDate(y, m - 1, d, 12, 0, 0, tz);
  const slotDate = new TZDate(dateObj, tz);
  slotDate.setHours(0, 0, 0, 0);
  const raw = generateSlots(slotDate, wh, appts, tz);
  if (wh.isEnabled === 0) return [];
  const [endH, endM] = wh.endTime.split(":").map(Number);
  const dayEnd = new TZDate(y, m - 1, d, endH, endM, 0, tz);
  const avail = new Set(raw.map((s) => s.start.getTime()));
  const out: number[] = [];
  for (const slot of raw) {
    if (addMinutes(slot.start, total).getTime() > dayEnd.getTime()) continue;
    const n = Math.ceil(total / 15);
    let ok = true;
    for (let i = 1; i < n; i++) {
      if (!avail.has(addMinutes(slot.start, i * 15).getTime())) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(slot.start.getTime());
  }
  return out;
}

describe("legacy equivalence: generateSlots scenarios (availability.test.ts)", () => {
  const TZ_UTC = "UTC";
  const day = "2026-03-15";
  const base = new TZDate(2026, 2, 15, 0, 0, 0, 0, TZ_UTC);
  const t = (h: number, m: number) => new TZDate(2026, 2, 15, h, m, 0, 0, TZ_UTC) as Date;
  const slot = (a: [number, number], b: [number, number]): TimeSlot => ({
    start: t(...a),
    end: t(...b),
  });
  const wh = (startTime: string, endTime: string, isEnabled = 1): WorkingHoursConfig => ({
    startTime,
    endTime,
    isEnabled,
  });

  const scenarios: {
    name: string;
    wh: WorkingHoursConfig;
    appts: TimeSlot[];
    duration?: number;
  }[] = [
    { name: "full day of 15-min slots", wh: wh("09:00", "17:00"), appts: [] },
    { name: "appointment mid-day", wh: wh("09:00", "17:00"), appts: [slot([12, 0], [13, 0])] },
    { name: "disabled day", wh: wh("09:00", "17:00", 0), appts: [] },
    { name: "appointment at open", wh: wh("09:00", "17:00"), appts: [slot([9, 0], [9, 30])] },
    { name: "appointment spans whole day", wh: wh("09:00", "17:00"), appts: [slot([9, 0], [17, 0])] },
    {
      name: "multiple appointments",
      wh: wh("09:00", "12:00"),
      appts: [slot([9, 0], [9, 30]), slot([10, 0], [10, 30])],
    },
    { name: "custom 30 minute slot duration", wh: wh("09:00", "10:00"), appts: [], duration: 30 },
  ];

  it.each(scenarios)("$name", ({ wh: w, appts, duration }) => {
    const legacy = generateSlots(base, w, appts, TZ_UTC, duration ?? 15);
    const engine = computeSlots(
      engineInput({
        day,
        tz: TZ_UTC,
        start: w.startTime,
        end: w.endTime,
        busy: toBusy(appts),
        total: duration ?? 15,
        interval: duration ?? 15,
        enabled: w.isEnabled === 1,
      }),
    );
    expect(ms(engine.map((s) => s.start))).toEqual(ms(legacy.map((s) => s.start)));
    expect(ms(engine.map((s) => s.end))).toEqual(ms(legacy.map((s) => s.end)));
  });

  it("DST days in America/New_York produce the same 15-minute grid", () => {
    for (const [d, start, end] of [
      ["2026-03-08", "00:00", "06:00"],
      ["2026-11-01", "00:00", "06:00"],
      ["2026-03-08", "09:00", "17:00"],
    ] as const) {
      const [y, m, dd] = d.split("-").map(Number);
      const date = new TZDate(y, m - 1, dd, 0, 0, 0, 0, "America/New_York");
      const legacy = generateSlots(date, wh(start, end), [], "America/New_York");
      const engine = computeSlots(
        engineInput({ day: d, tz: "America/New_York", start, end, total: 15 }),
      );
      expect(ms(engine.map((s) => s.start))).toEqual(ms(legacy.map((s) => s.start)));
    }
  });
});

describe("legacy equivalence: slot-fitting findAvailableStartTimes", () => {
  const tz = "UTC";
  const day = "2026-03-15";
  const date = new TZDate(2026, 2, 15, 0, 0, 0, 0, tz);
  const t = (h: number, m: number) => new TZDate(2026, 2, 15, h, m, 0, 0, tz) as Date;

  it.each([
    [60, [[10, 0, 11, 0]]],
    [45, [[9, 30, 10, 0], [13, 0, 14, 30]]],
    [90, []],
    [120, [[16, 0, 17, 0]]],
    [15, [[9, 0, 17, 0]]],
  ] as [number, number[][]][])("total %i min", (total, raw) => {
    const appts = raw.map(([a, b, c, d]) => ({ start: t(a, b), end: t(c, d) }));
    const w = { startTime: "09:00", endTime: "17:00", isEnabled: 1 };
    const legacy = findAvailableStartTimes(date, w, appts, total, tz);
    const engine = computeSlots(
      engineInput({ day, tz, start: "09:00", end: "17:00", busy: toBusy(appts), total }),
    );
    expect(ms(engine.map((s) => s.start))).toEqual(ms(legacy));
  });
});

describe("legacy equivalence: public slot path (booking-public.ts getAvailableSlots)", () => {
  const tz = "America/New_York";
  const day = "2026-06-17";
  const w = { startTime: "09:00", endTime: "17:00", isEnabled: 1 };
  const at = (h: number, m: number) => new TZDate(2026, 5, 17, h, m, 0, 0, tz) as Date;

  it("multiple-of-15 durations match exactly", () => {
    const appts: TimeSlot[] = [
      { start: at(10, 0), end: at(11, 0) },
      { start: at(14, 15), end: at(14, 45) },
    ];
    for (const total of [15, 30, 60, 75, 120]) {
      const legacy = legacyPublicStarts(day, tz, w, appts, total);
      const engine = computeSlots(
        engineInput({ day, tz, start: "09:00", end: "17:00", busy: toBusy(appts), total }),
      );
      expect(ms(engine.map((s) => s.start)), `total=${total}`).toEqual(legacy);
    }
  });

  it("LEGACY DIFFERENCE: time blocks are excluded by the engine but shown by the legacy public path", () => {
    const block = { start: at(12, 0), end: at(13, 0) };
    // legacy getAvailableSlotsForStaffMember loads appointments + external events only
    const legacy = legacyPublicStarts(day, tz, w, [], 60);
    const engine = computeSlots(
      engineInput({
        day,
        tz,
        start: "09:00",
        end: "17:00",
        total: 60,
        busy: [{ staffId: STAFF, kind: "block", interval: block }],
      }),
    );
    const engineMs = new Set(ms(engine.map((s) => s.start)));
    expect(legacy).toContain(at(12, 0).getTime());
    expect(legacy).toContain(at(12, 30).getTime());
    expect(engineMs.has(at(12, 0).getTime())).toBe(false);
    expect(engineMs.has(at(12, 30).getTime())).toBe(false);
    expect(engineMs.has(at(11, 0).getTime())).toBe(true); // ends exactly at the block start
    expect(engineMs.has(at(13, 0).getTime())).toBe(true);
  });

  it("LEGACY DIFFERENCE: non-multiple-of-15 durations are over-blocked by legacy sub-slot checking", () => {
    // 20 minute service, appointment 09:20-09:40: 09:00-09:20 is genuinely free.
    const appts: TimeSlot[] = [{ start: at(9, 20), end: at(9, 40) }];
    const legacy = legacyPublicStarts(day, tz, w, appts, 20);
    const engine = computeSlots(
      engineInput({ day, tz, start: "09:00", end: "17:00", busy: toBusy(appts), total: 20 }),
    );
    expect(legacy).not.toContain(at(9, 0).getTime());
    expect(ms(engine.map((s) => s.start))).toContain(at(9, 0).getTime());
  });
});

describe("legacy equivalence: findProcessingGaps scenarios (smart-scheduling.test.ts)", () => {
  const tz = "UTC";
  const day = "2026-03-26";
  const baseDate = new Date("2026-03-26T09:00:00Z");

  function makeAppt(o: Partial<ScheduledAppointment> & { id: string }): ScheduledAppointment {
    return {
      start: baseDate,
      end: addMinutes(baseDate, 90),
      locationId: "loc-1",
      activeMinutes: null,
      processingMinutes: null,
      isDoubleBook: false,
      ...o,
    };
  }

  /**
   * Caller-side mapping the data layer will do in step 2.5: appointments become Busy
   * items; hosts get their processing gap; existing double-books carry flexHostId.
   * Location filtering of hosts is the caller's job (Busy has no location).
   */
  function toEngineBusy(appts: ScheduledAppointment[], requiredLocationId?: string | null): Busy[] {
    return appts.map((a) => {
      const isHost =
        !a.isDoubleBook &&
        (!requiredLocationId || a.locationId === requiredLocationId) &&
        a.activeMinutes != null && a.activeMinutes > 0 &&
        a.processingMinutes != null && a.processingMinutes > 0;
      const b: Busy = {
        staffId: STAFF,
        kind: "appointment",
        appointmentId: a.id,
        interval: { start: a.start, end: a.end },
      };
      if (isHost) {
        const gs = addMinutes(a.start, a.activeMinutes!);
        b.processingGaps = [{ start: gs, end: addMinutes(gs, a.processingMinutes!) }];
      }
      if (a.isDoubleBook) b.flexHostId = a.doubleBookParentAppointmentId ?? "__orphan__";
      return b;
    });
  }

  function engineFlexStarts(appts: ScheduledAppointment[], total: number, loc?: string | null) {
    const input = engineInput({
      day, tz, start: "00:00", end: "24:00", total,
      busy: toEngineBusy(appts, loc),
    });
    return computeSlots(input)
      .filter((s) => s.isFlex)
      .map((s) => ({ start: s.start.getTime(), host: s.hostAppointmentId }));
  }

  function check(appts: ScheduledAppointment[], total: number, loc?: string | null) {
    const legacy = findProcessingGaps(appts, total, loc).map((s) => ({
      start: s.start.getTime(),
      host: s.duringProcessingOf,
    }));
    expect(engineFlexStarts(appts, total, loc)).toEqual(legacy);
    return legacy;
  }

  const m = (n: number) => addMinutes(baseDate, n);

  it("no appointments", () => {
    expect(check([], 30)).toEqual([]);
  });

  it("appointment without processing time", () => {
    expect(check([makeAppt({ id: "appt-1" })], 30)).toEqual([]);
  });

  it("service fits exactly in the processing window", () => {
    const r = check([makeAppt({ id: "appt-1", end: m(75), activeMinutes: 45, processingMinutes: 30 })], 30);
    expect(r).toHaveLength(1);
  });

  it("service too long for the processing window", () => {
    expect(
      check([makeAppt({ id: "appt-1", end: m(75), activeMinutes: 45, processingMinutes: 30 })], 45),
    ).toEqual([]);
  });

  it("multiple appointments, one with a gap, no conflict", () => {
    const r = check(
      [
        makeAppt({ id: "appt-1", end: m(90), activeMinutes: 45, processingMinutes: 30 }),
        makeAppt({ id: "appt-2", start: m(120), end: m(180) }),
      ],
      20,
    );
    expect(r).toHaveLength(1);
  });

  it("gap overlaps another appointment", () => {
    expect(
      check(
        [
          makeAppt({ id: "appt-1", end: m(75), activeMinutes: 45, processingMinutes: 30 }),
          makeAppt({ id: "appt-2", start: m(50), end: m(110) }),
        ],
        30,
      ),
    ).toEqual([]);
  });

  it("multiple slots from multiple processing appointments", () => {
    const r = check(
      [
        makeAppt({ id: "appt-1", end: m(90), activeMinutes: 45, processingMinutes: 45 }),
        makeAppt({ id: "appt-2", start: m(120), end: m(210), activeMinutes: 30, processingMinutes: 60 }),
      ],
      30,
    );
    expect(r.map((x) => x.host)).toEqual(["appt-1", "appt-2"]);
  });

  it("host that already has a linked flex child offers no flex", () => {
    expect(
      check(
        [
          makeAppt({ id: "host-1", end: m(75), activeMinutes: 45, processingMinutes: 30 }),
          makeAppt({
            id: "flex-existing", start: m(45), end: m(75), isDoubleBook: true,
            doubleBookParentAppointmentId: "host-1",
          }),
        ],
        30,
      ),
    ).toEqual([]);
  });

  it("existing double-book without a parent id is ignored when checking conflicts", () => {
    const r = check(
      [
        makeAppt({ id: "appt-1", end: m(90), activeMinutes: 45, processingMinutes: 45 }),
        makeAppt({ id: "appt-db", start: m(45), end: m(75), isDoubleBook: true }),
      ],
      30,
    );
    expect(r).toHaveLength(1);
  });

  it("double-booked appointments never act as hosts", () => {
    expect(
      check(
        [makeAppt({ id: "appt-db", end: m(60), isDoubleBook: true, activeMinutes: 30, processingMinutes: 30 })],
        15,
      ),
    ).toEqual([]);
  });

  it("only hosts at the selected location", () => {
    const r = check(
      [
        makeAppt({ id: "appt-1", locationId: "loc-1", end: m(90), activeMinutes: 45, processingMinutes: 45 }),
        makeAppt({ id: "appt-2", locationId: "loc-2", start: m(120), end: m(210), activeMinutes: 30, processingMinutes: 60 }),
      ],
      30,
      "loc-2",
    );
    expect(r.map((x) => x.host)).toEqual(["appt-2"]);
  });

  it("appointments at other locations still block", () => {
    expect(
      check(
        [
          makeAppt({ id: "processing-appt", locationId: "loc-1", end: m(90), activeMinutes: 45, processingMinutes: 45 }),
          makeAppt({ id: "other-location-blocker", locationId: "loc-2", start: m(50), end: m(95) }),
        ],
        30,
        "loc-1",
      ),
    ).toEqual([]);
  });

  it("short service inside a long gap", () => {
    const r = check([makeAppt({ id: "appt-1", end: m(90), activeMinutes: 45, processingMinutes: 45 })], 15);
    expect(r).toHaveLength(1);
  });

  it("LEGACY DIFFERENCE: a time block inside the gap blocks flex in the engine, legacy offers it", () => {
    const appts = [makeAppt({ id: "appt-1", end: m(75), activeMinutes: 45, processingMinutes: 30 })];
    const legacy = findProcessingGaps(appts, 30);
    expect(legacy).toHaveLength(1);
    const input = engineInput({
      day, tz, start: "00:00", end: "24:00", total: 30,
      busy: [
        ...toEngineBusy(appts),
        { staffId: STAFF, kind: "block", interval: { start: m(50), end: m(60) } },
      ],
    });
    expect(computeSlots(input).filter((s) => s.isFlex)).toEqual([]);
  });

  it("LEGACY DIFFERENCE: flex outside working hours is not offered by the engine", () => {
    const appts = [makeAppt({ id: "appt-1", end: m(75), activeMinutes: 45, processingMinutes: 30 })];
    expect(findProcessingGaps(appts, 30)).toHaveLength(1);
    const input = engineInput({
      day, tz, start: "09:00", end: "09:30", total: 30, busy: toEngineBusy(appts),
    });
    expect(computeSlots(input).filter((s) => s.isFlex)).toEqual([]);
  });

  it("flex off in the engine gives no double-book slots (legacy rules have flex on)", () => {
    const appts = [makeAppt({ id: "appt-1", end: m(75), activeMinutes: 45, processingMinutes: 30 })];
    const input = engineInput({
      day, tz, start: "00:00", end: "24:00", total: 30, flex: false, busy: toEngineBusy(appts),
    });
    expect(computeSlots(input).some((s) => s.isFlex)).toBe(false);
  });
});

describe("legacy equivalence: randomized (fast-check, 300 runs each)", () => {
  const tz = "America/New_York";
  const day = "2026-06-17";
  const date = new TZDate(2026, 5, 17, 0, 0, 0, 0, tz);
  const at = (minutes: number) =>
    new TZDate(2026, 5, 17, Math.floor(minutes / 60), minutes % 60, 0, 0, tz) as Date;

  const hoursArb = fc
    .tuple(fc.integer({ min: 0, max: 40 }), fc.integer({ min: 1, max: 60 }))
    .map(([a, len]) => ({ s: 6 * 60 + a * 15, e: Math.min(22 * 60, 6 * 60 + a * 15 + len * 15) }));
  const apptsArb = fc.array(
    fc.tuple(fc.integer({ min: 6 * 4, max: 22 * 4 - 1 }), fc.integer({ min: 1, max: 12 })),
    { maxLength: 8 },
  );

  const toSlots = (list: [number, number][]): TimeSlot[] =>
    list.map(([q, len]) => ({ start: at(q * 15), end: at(q * 15 + len * 15) }));

  it("slot-fitting equals engine for any hours, appointments and duration", () => {
    fc.assert(
      fc.property(hoursArb, apptsArb, fc.integer({ min: 1, max: 240 }), (h, raw, total) => {
        const appts = toSlots(raw);
        const w = {
          startTime: `${String(Math.floor(h.s / 60)).padStart(2, "0")}:${String(h.s % 60).padStart(2, "0")}`,
          endTime: `${String(Math.floor(h.e / 60)).padStart(2, "0")}:${String(h.e % 60).padStart(2, "0")}`,
          isEnabled: 1,
        };
        const legacy = findAvailableStartTimes(date, w, appts, total, tz);
        const engine = computeSlots(
          engineInput({ day, tz, start: w.startTime, end: w.endTime, busy: toBusy(appts), total }),
        );
        expect(ms(engine.map((s) => s.start))).toEqual(ms(legacy));
      }),
      { numRuns: 300 },
    );
  });

  it("public path equals engine for multiple-of-15 durations", () => {
    fc.assert(
      fc.property(hoursArb, apptsArb, fc.integer({ min: 1, max: 16 }), (h, raw, q) => {
        const appts = toSlots(raw);
        const pad = (n: number) => String(n).padStart(2, "0");
        const w = {
          startTime: `${pad(Math.floor(h.s / 60))}:${pad(h.s % 60)}`,
          endTime: `${pad(Math.floor(h.e / 60))}:${pad(h.e % 60)}`,
          isEnabled: 1,
        };
        const total = q * 15;
        const legacy = legacyPublicStarts(day, tz, w, appts, total);
        const engine = computeSlots(
          engineInput({ day, tz, start: w.startTime, end: w.endTime, busy: toBusy(appts), total }),
        );
        expect(ms(engine.map((s) => s.start))).toEqual(legacy);
      }),
      { numRuns: 300 },
    );
  });
});
