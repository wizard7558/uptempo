import { describe, expect, it } from "vitest";
import { computeSlots } from "./engine";
import {
  OVERRIDE_HOST,
  buildEngineInput,
  buildRules,
  buildServiceRequest,
  dayLoadFor,
  simpleServiceRequest,
  snapshotBusy,
} from "./input";
import type {
  AppointmentRow,
  SchedulingSettings,
  SchedulingSnapshot,
  ServiceNeedRow,
  ServiceTimingRow,
} from "./load";
import { DAY, TZ, at, labels } from "./testing";

const L1 = "11111111-1111-4111-8111-111111111111";
const L2 = "22222222-2222-4222-8222-222222222222";

const SETTINGS: SchedulingSettings = {
  timezone: TZ,
  minNoticeMinutes: 0,
  maxAdvanceDays: 28,
  slotIntervalMinutes: 15,
  sameDayBooking: false,
  arrivalWindowMin: 120,
};

function appt(
  over: Omit<Partial<AppointmentRow>, "start" | "end"> & { id: string; start: string; end: string },
): AppointmentRow {
  const { start, end, ...rest } = over;
  return {
    staffId: "a",
    start: at(start),
    end: at(end),
    locationId: L1,
    isDoubleBook: false,
    parentId: null,
    activeMinutes: null,
    processingMinutes: null,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    ...rest,
  } as AppointmentRow;
}

function snap(over: Partial<SchedulingSnapshot> = {}): SchedulingSnapshot {
  return {
    timezone: TZ,
    fromDay: DAY,
    toDay: DAY,
    locationId: L1,
    hours: [
      { staffId: "a", dayOfWeek: 3, startTime: "09:00", endTime: "17:00", locationId: L1 },
    ],
    overrides: [],
    appointments: [],
    timeBlocks: [],
    external: [],
    tasks: [],
    resources: [],
    resourceUses: [],
    ...over,
  };
}

describe("snapshotBusy", () => {
  it("derives a host processing gap from the unbuffered start", () => {
    const busy = snapshotBusy(
      snap({
        appointments: [
          appt({
            id: "h",
            start: "09:00",
            end: "10:15",
            activeMinutes: 45,
            processingMinutes: 30,
            bufferBeforeMinutes: 10,
            bufferAfterMinutes: 5,
          }),
        ],
      }),
    );
    expect(busy).toHaveLength(1);
    expect(busy[0].interval.start).toEqual(at("08:50"));
    expect(busy[0].interval.end).toEqual(at("10:20"));
    expect(busy[0].processingGaps).toEqual([{ start: at("09:45"), end: at("10:15") }]);
    expect(busy[0].flexHostId).toBeUndefined();
  });

  it("marks a flex child with its host id", () => {
    const busy = snapshotBusy(
      snap({
        appointments: [appt({ id: "c", start: "09:45", end: "10:15", isDoubleBook: true, parentId: "h" })],
      }),
    );
    expect(busy[0].flexHostId).toBe("h");
    expect(busy[0].processingGaps).toBeUndefined();
  });

  it("uses the override marker for a double-book with no parent", () => {
    const busy = snapshotBusy(
      snap({ appointments: [appt({ id: "o", start: "10:00", end: "11:00", isDoubleBook: true })] }),
    );
    expect(busy[0].flexHostId).toBe(OVERRIDE_HOST);
  });

  it("gives no gap when the host is at another location than the query", () => {
    const busy = snapshotBusy(
      snap({
        locationId: L1,
        appointments: [
          appt({ id: "h", start: "09:00", end: "10:15", locationId: L2, activeMinutes: 45, processingMinutes: 30 }),
        ],
      }),
    );
    expect(busy[0].processingGaps).toBeUndefined();
  });

  it("keeps the gap when no location is requested", () => {
    const busy = snapshotBusy(
      snap({
        locationId: null,
        appointments: [
          appt({ id: "h", start: "09:00", end: "10:15", locationId: L2, activeMinutes: 45, processingMinutes: 30 }),
        ],
      }),
    );
    expect(busy[0].processingGaps).toHaveLength(1);
  });

  it("maps blocks, external events and tasks to their kinds", () => {
    const iv = { start: at("12:00"), end: at("13:00") };
    const busy = snapshotBusy(
      snap({
        timeBlocks: [{ staffId: "a", ...iv }],
        external: [{ staffId: "a", ...iv }],
        tasks: [{ staffId: "a", ...iv }],
        resourceUses: [{ resourceId: "r1", appointmentId: "x", ...iv }],
      }),
    );
    expect(busy.map((b) => b.kind)).toEqual(["block", "external", "task", "appointment"]);
    expect(busy[3].resourceId).toBe("r1");
    expect(busy[3].staffId).toBeUndefined();
  });
});

describe("dayLoadFor", () => {
  it("counts appointments per staff member by local start day", () => {
    const s = snap({
      appointments: [
        appt({ id: "1", start: "09:00", end: "10:00" }),
        appt({ id: "2", start: "11:00", end: "12:00" }),
        appt({ id: "3", start: "11:00", end: "12:00", staffId: "b" }),
      ],
    });
    expect(dayLoadFor(s, DAY)).toEqual({ a: 2, b: 1 });
    expect(dayLoadFor(s, "2026-06-18")).toEqual({});
  });
});

describe("buildRules", () => {
  const noon = new Date("2026-06-17T16:00:00Z"); // 12:00 EDT

  it("legacy rule: same-day off makes notice reach the next local midnight", () => {
    const r = buildRules(SETTINGS, noon, { extraAdvanceDays: 0, allowFlex: true });
    expect(r.minNoticeMinutes).toBe(720);
    expect(r.maxAdvanceDays).toBe(28);
    expect(r.slotIntervalMinutes).toBe(15);
    expect(r.allowFlex).toBe(true);
  });

  it("same-day on uses the configured notice", () => {
    const r = buildRules({ ...SETTINGS, sameDayBooking: true, minNoticeMinutes: 120 }, noon, {
      extraAdvanceDays: 0,
      allowFlex: false,
    });
    expect(r.minNoticeMinutes).toBe(120);
  });

  it("adds priority days and honors per-service timing", () => {
    const r = buildRules(SETTINGS, noon, {
      extraAdvanceDays: 7,
      allowFlex: false,
      timing: { minNoticeMinutes: 2000, maxAdvanceDays: 10, slotIntervalMinutes: 30 },
    });
    expect(r.minNoticeMinutes).toBe(2000);
    expect(r.maxAdvanceDays).toBe(17);
    expect(r.slotIntervalMinutes).toBe(30);
  });
});

describe("buildEngineInput", () => {
  const service = simpleServiceRequest(60);

  it("maps hours and clips busy items to the day", () => {
    const s = snap({
      timeBlocks: [
        { staffId: "a", start: at("12:00"), end: at("13:00") },
        { staffId: "a", start: at("12:00", "2026-06-18"), end: at("13:00", "2026-06-18") },
      ],
    });
    const rules = buildRules(SETTINGS, new Date("2026-06-01T00:00:00Z"), { extraAdvanceDays: 0, allowFlex: false });
    const input = buildEngineInput(s, DAY, { candidateStaffIds: ["a"], anyStaff: false, service, rules });
    expect(input.hours).toEqual([
      { staffId: "a", dayOfWeek: 3, start: "09:00", end: "17:00", locationId: L1 },
    ]);
    expect(input.busy).toHaveLength(1);
    const all = buildEngineInput(s, DAY, {
      candidateStaffIds: ["a"],
      anyStaff: false,
      service,
      rules,
      clipToDay: false,
    });
    expect(all.busy).toHaveLength(2);
  });

  it("legacy rule makes today TOO_SOON through computeSlots, tomorrow open", () => {
    const now = new Date("2026-06-17T13:00:00Z"); // 09:00 EDT on DAY
    const s = snap({
      hours: [
        { staffId: "a", dayOfWeek: 3, startTime: "09:00", endTime: "17:00", locationId: L1 },
        { staffId: "a", dayOfWeek: 4, startTime: "09:00", endTime: "17:00", locationId: L1 },
      ],
    });
    const rules = buildRules(SETTINGS, now, { extraAdvanceDays: 0, allowFlex: true });
    const today = computeSlots(buildEngineInput(s, DAY, { candidateStaffIds: ["a"], anyStaff: false, service, rules }));
    expect(today).toEqual([]);
    const tomorrow = computeSlots(
      buildEngineInput(s, "2026-06-18", { candidateStaffIds: ["a"], anyStaff: false, service, rules }),
    );
    expect(labels(tomorrow.map((t) => t.start))[0]).toBe("09:00");
  });

  it("a flex slot appears in the host gap and disappears once a child exists", () => {
    const rules = buildRules(SETTINGS, new Date("2026-06-01T00:00:00Z"), { extraAdvanceDays: 0, allowFlex: true });
    const host = appt({ id: "h", start: "09:00", end: "10:15", activeMinutes: 45, processingMinutes: 30 });
    const child = appt({ id: "c", start: "09:45", end: "10:15", isDoubleBook: true, parentId: "h" });
    const half = simpleServiceRequest(30);
    const run = (appointments: AppointmentRow[]) =>
      computeSlots(
        buildEngineInput(snap({ appointments }), DAY, {
          candidateStaffIds: ["a"],
          anyStaff: false,
          service: half,
          rules,
        }),
      );
    const withHost = run([host]);
    expect(withHost.find((x) => x.isFlex)?.hostAppointmentId).toBe("h");
    expect(run([host, child]).some((x) => x.isFlex)).toBe(false);
  });
});

describe("buildServiceRequest", () => {
  const timing = (over: Partial<ServiceTimingRow> = {}): ServiceTimingRow => ({
    id: "s",
    bufferBeforeMin: 0,
    bufferAfterMin: 0,
    minNoticeMin: null,
    maxAdvanceDays: null,
    slotIntervalMin: null,
    locationType: "in_studio",
    ...over,
  });

  it("returns plain defaults for no services", () => {
    const r = buildServiceRequest({ totalMinutes: 30 }, []);
    expect(r.request).toMatchObject({
      totalMinutes: 30,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      locationType: "in_studio",
    });
    expect(r.timing).toEqual({ minNoticeMinutes: null, maxAdvanceDays: null, slotIntervalMinutes: null });
  });

  it("takes the largest buffers", () => {
    const r = buildServiceRequest({ totalMinutes: 90 }, [
      timing({ bufferBeforeMin: 10, bufferAfterMin: 5 }),
      timing({ bufferBeforeMin: 5, bufferAfterMin: 20 }),
    ]);
    expect(r.request.bufferBeforeMinutes).toBe(10);
    expect(r.request.bufferAfterMinutes).toBe(20);
  });

  it("takes the largest notice and the smallest horizon and grid, ignoring unset values", () => {
    const r = buildServiceRequest({ totalMinutes: 60 }, [
      timing({ minNoticeMin: 60, maxAdvanceDays: 90, slotIntervalMin: 30 }),
      timing({ minNoticeMin: 240, maxAdvanceDays: 14, slotIntervalMin: 10 }),
      timing(),
    ]);
    expect(r.timing).toEqual({ minNoticeMinutes: 240, maxAdvanceDays: 14, slotIntervalMinutes: 10 });
  });

  it("keeps a notice of 0 (set, so it is not ignored)", () => {
    const r = buildServiceRequest({ totalMinutes: 60 }, [timing({ minNoticeMin: 0 }), timing()]);
    expect(r.timing.minNoticeMinutes).toBe(0);
  });

  it("is virtual only when every service is virtual; on_site maps to in_studio", () => {
    expect(
      buildServiceRequest({ totalMinutes: 30 }, [timing({ locationType: "virtual" })]).request.locationType,
    ).toBe("virtual");
    expect(
      buildServiceRequest({ totalMinutes: 30 }, [
        timing({ locationType: "virtual" }),
        timing({ locationType: "in_studio" }),
      ]).request.locationType,
    ).toBe("in_studio");
    expect(
      buildServiceRequest({ totalMinutes: 30 }, [timing({ locationType: "on_site" })]).request.locationType,
    ).toBe("in_studio");
  });

  it("maps on_site to on_site only when travel data exists", () => {
    const on = [timing({ locationType: "on_site" })];
    expect(buildServiceRequest({ totalMinutes: 30 }, on, [], true).request.locationType).toBe("on_site");
    expect(buildServiceRequest({ totalMinutes: 30 }, on, [], false).request.locationType).toBe("in_studio");
    // hasTravel never turns an in-studio service into an on-site one.
    expect(
      buildServiceRequest({ totalMinutes: 30 }, [timing({ locationType: "in_studio" })], [], true).request
        .locationType,
    ).toBe("in_studio");
  });

  it("applies the service buffers in the engine and the timing overrides in the rules", () => {
    const { request, timing: t } = buildServiceRequest({ totalMinutes: 60 }, [
      timing({ bufferBeforeMin: 15, bufferAfterMin: 15, slotIntervalMin: 30 }),
    ]);
    const rules = buildRules(SETTINGS, new Date("2026-06-01T00:00:00Z"), {
      extraAdvanceDays: 0,
      allowFlex: false,
      timing: t,
    });
    expect(rules.slotIntervalMinutes).toBe(30);
    const s: SchedulingSnapshot = {
      timezone: TZ,
      fromDay: DAY,
      toDay: DAY,
      locationId: null,
      hours: [{ staffId: "a", dayOfWeek: 3, startTime: "09:00", endTime: "12:00", locationId: null }],
      overrides: [],
      appointments: [],
      timeBlocks: [],
      external: [],
      tasks: [],
      resources: [],
      resourceUses: [],
    };
    const slots = computeSlots(
      buildEngineInput(s, DAY, { candidateStaffIds: ["a"], anyStaff: false, service: request, rules }),
    );
    // 15 min prep + 60 min + 15 min cleanup inside 09:00-12:00 on a 30-minute grid.
    expect(labels(slots.map((x) => x.start))).toEqual(["09:30", "10:00", "10:30"]);
  });

  describe("resource needs", () => {
    const lines = [
      { serviceId: "wash", durationMinutes: 30 },
      { serviceId: "color", durationMinutes: 60 },
      { serviceId: "dry", durationMinutes: 20 },
    ];
    const need = (over: Partial<ServiceNeedRow> & { serviceId: string }): ServiceNeedRow => ({
      resourceKind: "chair",
      resourceId: null,
      quantity: 1,
      offsetMin: 0,
      durationMin: null,
      ...over,
    });

    it("has none by default", () => {
      expect(buildServiceRequest({ totalMinutes: 30 }, []).request.resourceNeeds).toEqual([]);
    });

    it("starts a need after the services listed before its own, plus its own offset", () => {
      const r = buildServiceRequest({ totalMinutes: 110, services: lines }, [], [
        need({ serviceId: "wash" }),
        need({ serviceId: "color", offsetMin: 10, durationMin: 25 }),
        need({ serviceId: "dry", resourceKind: null, resourceId: "dryer-1", quantity: 2 }),
      ]);
      expect(r.request.resourceNeeds).toEqual([
        { kind: "chair", quantity: 1, offsetMinutes: 0, durationMinutes: 30 },
        { kind: "chair", quantity: 1, offsetMinutes: 40, durationMinutes: 25 },
        { resourceId: "dryer-1", quantity: 2, offsetMinutes: 90, durationMinutes: 20 },
      ]);
    });

    it("skips needs of services that are not part of the booking", () => {
      const r = buildServiceRequest({ totalMinutes: 30, services: lines.slice(0, 1) }, [], [
        need({ serviceId: "color" }),
      ]);
      expect(r.request.resourceNeeds).toEqual([]);
    });
  });
});
