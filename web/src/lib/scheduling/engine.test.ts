import { describe, expect, it } from "vitest";
import { computeSlots, evaluateStart, explainSlot, pickResourcesAt, staffWindows } from "./engine";
import { at, busy, DAY, iv, labels, makeInput, TZ, weekly } from "./testing";
import { estimateTravelMinutes } from "./travel";
import type { EngineInput, RejectReason } from "./types";

const starts = (input: EngineInput) => labels(computeSlots(input).map((s) => s.start));

describe("hours and grid", () => {
  it("steps by slotIntervalMinutes and keeps the whole service inside hours", () => {
    const out = starts(makeInput({ hours: weekly("a", "09:00", "11:00") }));
    // 60 minute service in 09:00-11:00 -> last start 10:00
    expect(out).toEqual(["09:00", "09:15", "09:30", "09:45", "10:00"]);
  });

  it("honors a 30 minute interval", () => {
    const input = makeInput({ hours: weekly("a", "09:00", "11:00") });
    input.rules.slotIntervalMinutes = 30;
    expect(starts(input)).toEqual(["09:00", "09:30", "10:00"]);
  });

  it("buffers must sit inside working hours", () => {
    const input = makeInput({ hours: weekly("a", "09:00", "11:00") });
    input.service.bufferBeforeMinutes = 15;
    input.service.bufferAfterMinutes = 30;
    // occupied span = start-15 .. start+90 -> start in [09:15, 09:30]
    expect(starts(input)).toEqual(["09:15", "09:30"]);
  });

  it("supports split shifts and never spans the gap", () => {
    const hours = [
      ...weekly("a", "09:00", "11:00"),
      ...weekly("a", "13:00", "15:00"),
    ];
    const out = starts(makeInput({ hours }));
    expect(out).toEqual([
      "09:00", "09:15", "09:30", "09:45", "10:00",
      "13:00", "13:15", "13:30", "13:45", "14:00",
    ]);
  });

  it("merges abutting intervals at the same location", () => {
    const hours = [...weekly("a", "09:00", "12:00"), ...weekly("a", "12:00", "14:00")];
    expect(starts(makeInput({ hours }))).toContain("11:30");
  });

  it("does not merge abutting intervals at different locations", () => {
    const hours = [...weekly("a", "09:00", "12:00", "L1"), ...weekly("a", "12:00", "14:00", "L2")];
    const out = starts(makeInput({ hours }));
    expect(out).not.toContain("11:30");
    const slot = computeSlots(makeInput({ hours })).find((s) => labels([s.start])[0] === "12:00");
    expect(slot?.locationId).toBe("L2");
  });

  it("a closed override (empty intervals) removes the whole day", () => {
    const input = makeInput({ overrides: [{ staffId: "a", date: DAY, intervals: [] }] });
    expect(computeSlots(input)).toEqual([]);
    expect(explainSlot(input, at("10:00"), "a")).toEqual(["CLOSED_DAY"]);
  });

  it("an override replaces weekly hours for that date only", () => {
    const input = makeInput({
      overrides: [{ staffId: "a", date: DAY, intervals: [{ start: "10:00", end: "11:00", locationId: "X" }] }],
    });
    expect(starts(input)).toEqual(["10:00"]);
    expect(computeSlots(input)[0].locationId).toBe("X");
    const otherDay = { ...input, day: "2026-06-18" };
    expect(starts(otherDay)).toHaveLength(29);
  });

  it("an override for another staff member or date is ignored", () => {
    const input = makeInput({
      overrides: [
        { staffId: "b", date: DAY, intervals: [] },
        { staffId: "a", date: "2026-06-18", intervals: [] },
      ],
    });
    expect(starts(input)).toHaveLength(29);
  });

  it("a day with no weekly hours is closed", () => {
    const input = makeInput({ hours: weekly("a").filter((h) => h.dayOfWeek !== 3) });
    expect(computeSlots(input)).toEqual([]);
  });

  it("skips malformed zero-length intervals", () => {
    const input = makeInput({ hours: weekly("a", "09:00", "09:00") });
    expect(computeSlots(input)).toEqual([]);
  });
});

describe("busy items", () => {
  it("excludes starts whose span overlaps an appointment, allows touching", () => {
    const out = starts(makeInput({ hours: weekly("a", "09:00", "13:00"), busy: [busy("a", "10:00", "11:00")] }));
    // 60 min service: must end <= 10:00 or start >= 11:00
    expect(out).toEqual(["09:00", "11:00", "11:15", "11:30", "11:45", "12:00"]);
  });

  it("buffers extend the blocked area around busy items", () => {
    const input = makeInput({ hours: weekly("a", "09:00", "13:00"), busy: [busy("a", "10:00", "11:00")] });
    input.service.bufferBeforeMinutes = 15;
    input.service.bufferAfterMinutes = 15;
    // occupied = start-15..start+75; ends <=10:00 -> start <= 08:45(no); starts >= 11:15 and <= 11:45
    expect(starts(input)).toEqual(["11:15", "11:30", "11:45"]);
  });

  it("ignores busy items that belong to other staff", () => {
    const input = makeInput({
      candidateStaffIds: ["a", "b"],
      hours: [...weekly("a", "09:00", "10:00"), ...weekly("b", "09:00", "10:00")],
      busy: [busy("b", "09:00", "10:00")],
    });
    const slots = computeSlots(input);
    expect(slots.map((s) => s.staffId)).toEqual(["a"]);
  });

  it("task items block like calendar blocks", () => {
    const input = makeInput({ busy: [busy("a", "09:00", "17:00", "task")] });
    expect(computeSlots(input)).toEqual([]);
    expect(explainSlot(input, at("10:00"), "a")).toEqual(["BUSY_BLOCK"]);
  });

  it("reports every distinct busy reason at once", () => {
    const input = makeInput({
      busy: [
        busy("a", "10:00", "10:30", "appointment"),
        busy("a", "10:15", "10:45", "block"),
        busy("a", "10:30", "11:00", "external"),
        busy("a", "10:45", "11:30", "class"),
      ],
    });
    expect(explainSlot(input, at("10:00"), "a")).toEqual([
      "BUSY_APPOINTMENT", "BUSY_BLOCK", "BUSY_EXTERNAL", "BUSY_CLASS",
    ]);
  });
});

describe("resources", () => {
  const rooms = [
    { id: "r2", kind: "room", locationId: "L1", capacity: 1 },
    { id: "r1", kind: "room", locationId: "L1", capacity: 1 },
    { id: "r3", kind: "room", locationId: "L2", capacity: 1 },
    { id: "rx", kind: "room", locationId: null, capacity: 1 },
  ];

  it("picks the lowest-id free resource of the kind at the slot location", () => {
    const input = makeInput({ hours: weekly("a", "09:00", "10:00", "L1"), resources: rooms });
    input.service.resourceNeeds = [{ kind: "room", quantity: 1, offsetMinutes: 0, durationMinutes: null }];
    expect(computeSlots(input)[0].resourceIds).toEqual(["r1"]);
    input.busy = [{ resourceId: "r1", kind: "block", interval: iv("09:00", "10:00") }];
    expect(computeSlots(input)[0].resourceIds).toEqual(["r2"]);
  });

  it("uses location-less resources at any location, and other-location resources never", () => {
    const input = makeInput({ hours: weekly("a", "09:00", "10:00", "L2"), resources: rooms });
    input.service.resourceNeeds = [{ kind: "room", quantity: 2, offsetMinutes: 0, durationMinutes: null }];
    expect(computeSlots(input)[0].resourceIds).toEqual(["r3", "rx"]);
  });

  it("is RESOURCE_UNAVAILABLE when not enough are free", () => {
    const input = makeInput({ hours: weekly("a", "09:00", "10:00", "L1"), resources: rooms });
    input.service.resourceNeeds = [{ kind: "room", quantity: 4, offsetMinutes: 0, durationMinutes: null }];
    expect(computeSlots(input)).toEqual([]);
    expect(explainSlot(input, at("09:00"), "a")).toEqual(["RESOURCE_UNAVAILABLE"]);
  });

  it("checks only the sub-window given by offset and duration", () => {
    const input = makeInput({
      hours: weekly("a", "09:00", "12:00"),
      resources: [{ id: "chair", kind: "chair", locationId: null, capacity: 1 }],
      busy: [{ resourceId: "chair", kind: "block", interval: iv("09:00", "09:30") }],
    });
    // chair only needed from minute 30 to minute 60 of the service
    input.service.resourceNeeds = [{ kind: "chair", quantity: 1, offsetMinutes: 30, durationMinutes: 30 }];
    expect(labels([computeSlots(input)[0].start])).toEqual(["09:00"]);
    // whole-service need collides with the 09:00-09:30 busy item
    input.service.resourceNeeds = [{ kind: "chair", quantity: 1, offsetMinutes: 0, durationMinutes: null }];
    expect(labels([computeSlots(input)[0].start])).toEqual(["09:30"]);
  });

  it("supports specific resource needs and rejects unknown ids", () => {
    const input = makeInput({ hours: weekly("a", "09:00", "10:00"), resources: rooms });
    input.service.resourceNeeds = [{ resourceId: "r3", quantity: 1, offsetMinutes: 0, durationMinutes: null }];
    expect(computeSlots(input)[0].resourceIds).toEqual(["r3"]);
    input.service.resourceNeeds = [{ resourceId: "nope", quantity: 1, offsetMinutes: 0, durationMinutes: null }];
    expect(computeSlots(input)).toEqual([]);
  });

  it("does not reuse one resource for two needs", () => {
    const input = makeInput({
      hours: weekly("a", "09:00", "10:00"),
      resources: [{ id: "r1", kind: "room", locationId: null, capacity: 1 }],
    });
    input.service.resourceNeeds = [
      { kind: "room", quantity: 1, offsetMinutes: 0, durationMinutes: 30 },
      { kind: "room", quantity: 1, offsetMinutes: 30, durationMinutes: 30 },
    ];
    expect(computeSlots(input)).toEqual([]);
  });

  describe("capacity greater than 1", () => {
    const hall = { id: "hall", kind: "hall", locationId: null, capacity: 2 };
    const make = (items: [string, string][]) => {
      const input = makeInput({
        hours: weekly("a", "09:00", "10:00"),
        resources: [hall],
        busy: items.map(([s, e]) => ({ resourceId: "hall", kind: "appointment" as const, interval: iv(s, e) })),
      });
      input.service.resourceNeeds = [{ kind: "hall", quantity: 1, offsetMinutes: 0, durationMinutes: null }];
      return input;
    };

    it("is free while fewer than capacity bookings overlap", () => {
      expect(computeSlots(make([["09:00", "10:00"]]))).toHaveLength(1);
    });

    it("is full when capacity bookings overlap the window", () => {
      const input = make([["09:00", "10:00"], ["09:15", "09:45"]]);
      expect(computeSlots(input)).toHaveLength(0);
      expect(explainSlot(input, at("09:00"), "a")).toEqual(["RESOURCE_UNAVAILABLE"]);
    });

    it("counts peak concurrent use, not the number of overlapping bookings", () => {
      // Two bookings overlap the window but never at the same time.
      expect(computeSlots(make([["09:00", "09:30"], ["09:30", "10:00"]]))).toHaveLength(1);
    });

    it("reports the held interval in resourceAssignments", () => {
      const [slot] = computeSlots(make([["09:00", "10:00"]]));
      expect(slot.resourceIds).toEqual(["hall"]);
      expect(slot.resourceAssignments).toEqual([{ resourceId: "hall", interval: iv("09:00", "10:00") }]);
    });
  });

  it("omits resourceAssignments when the service needs nothing", () => {
    const [slot] = computeSlots(makeInput({ hours: weekly("a", "09:00", "10:00") }));
    expect(slot.resourceAssignments).toBeUndefined();
  });

  describe("pickResourcesAt and evaluateStart", () => {
    const chairs = [
      { id: "c1", kind: "chair", locationId: null, capacity: 1 },
      { id: "c2", kind: "chair", locationId: null, capacity: 1 },
    ];
    it("picks the first free chair and respects offsets", () => {
      const input = makeInput({
        hours: weekly("a", "09:00", "12:00"),
        resources: chairs,
        busy: [{ resourceId: "c1", kind: "appointment", interval: iv("09:00", "10:00") }],
      });
      input.service.resourceNeeds = [{ kind: "chair", quantity: 1, offsetMinutes: 15, durationMinutes: 30 }];
      expect(pickResourcesAt(input, at("09:00"), null)).toEqual([
        { resourceId: "c2", interval: iv("09:15", "09:45") },
      ]);
      expect(pickResourcesAt(input, at("10:00"), null)?.[0].resourceId).toBe("c1");
    });

    it("returns null when nothing is free, and [] when nothing is needed", () => {
      const input = makeInput({
        hours: weekly("a", "09:00", "12:00"),
        resources: chairs,
        busy: chairs.map((c) => ({ resourceId: c.id, kind: "appointment" as const, interval: iv("09:00", "10:00") })),
      });
      input.service.resourceNeeds = [{ kind: "chair", quantity: 1, offsetMinutes: 0, durationMinutes: null }];
      expect(pickResourcesAt(input, at("09:30"), null)).toBeNull();
      input.service.resourceNeeds = [];
      expect(pickResourcesAt(input, at("09:30"), null)).toEqual([]);
    });

    it("evaluateStart returns the slot with its assignments, or the reasons", () => {
      const input = makeInput({ hours: weekly("a", "09:00", "12:00"), resources: chairs });
      input.service.resourceNeeds = [{ kind: "chair", quantity: 1, offsetMinutes: 0, durationMinutes: null }];
      const ok = evaluateStart(input, at("09:00"), "a");
      expect(ok.reasons).toEqual([]);
      expect(ok.slot?.resourceAssignments?.[0].resourceId).toBe("c1");
      expect(evaluateStart(input, at("13:00"), "a").slot).toBeUndefined();
    });
  });

  it("a need without kind or resourceId can never be met", () => {
    const input = makeInput({ hours: weekly("a", "09:00", "10:00") });
    input.service.resourceNeeds = [{ quantity: 1, offsetMinutes: 0, durationMinutes: null }];
    expect(computeSlots(input)).toEqual([]);
  });
});

describe("notice, horizon, booking windows", () => {
  it("minNotice is relative to now", () => {
    const input = makeInput({ hours: weekly("a", "09:00", "12:00") });
    input.rules.now = at("08:00");
    input.rules.minNoticeMinutes = 90;
    expect(starts(input)[0]).toBe("09:30");
    expect(explainSlot(input, at("09:15"), "a")).toEqual(["TOO_SOON"]);
  });

  it("maxAdvanceDays counts calendar days in the salon timezone", () => {
    const input = makeInput();
    input.rules.now = new Date("2026-06-15T23:30:00-04:00"); // 2026-06-15 local
    input.rules.maxAdvanceDays = 2;
    expect(computeSlots(input).length).toBeGreaterThan(0); // DAY is +2
    input.rules.maxAdvanceDays = 1;
    expect(computeSlots(input)).toEqual([]);
    expect(explainSlot(input, at("10:00"), "a")).toEqual(["TOO_FAR"]);
  });

  it("bookingWindows restrict the slot start per staff", () => {
    const input = makeInput({ hours: weekly("a", "09:00", "12:00") });
    input.rules.bookingWindows = { a: [{ opensAt: at("10:00"), closesAt: at("10:30") }] };
    expect(starts(input)).toEqual(["10:00", "10:15"]);
    expect(explainSlot(input, at("09:00"), "a")).toEqual(["WINDOW_CLOSED"]);
    expect(explainSlot(input, at("10:30"), "a")).toEqual(["WINDOW_CLOSED"]);
  });

  it("staff without a bookingWindows entry are unrestricted; an empty list closes them", () => {
    const input = makeInput({
      candidateStaffIds: ["a", "b"],
      hours: [...weekly("a", "09:00", "10:00"), ...weekly("b", "09:00", "10:00")],
    });
    input.rules.bookingWindows = { b: [] };
    expect(computeSlots(input).map((s) => s.staffId)).toEqual(["a"]);
  });
});

describe("on-site travel", () => {
  const base = { lat: 40, lng: -74, speedKmh: 60, maxTravelMinutes: 60 };
  const job = { lat: 40.1, lng: -74 }; // ~20 min at 60 km/h
  const mk = (neighbors: NonNullable<EngineInput["travel"]>["neighbors"] = []) => {
    const input = makeInput({
      hours: weekly("a", "09:00", "17:00"),
      travel: { jobPoint: job, staffBase: { a: base }, neighbors },
    });
    input.service.locationType = "on_site";
    return input;
  };

  it("sets travelBeforeMinutes from base and a 2h arrival window", () => {
    const [first] = computeSlots(mk());
    expect(first.travelBeforeMinutes).toBe(estimateTravelMinutes(base, job, 60));
    expect(first.travelBeforeMinutes).toBe(20);
    expect(first.arrivalWindow?.start).toEqual(first.start);
    expect(first.arrivalWindow!.end.getTime() - first.start.getTime()).toBe(2 * 3600_000);
  });

  it("requires the gap after the previous job to hold the travel time", () => {
    const prev = { staffId: "a", point: { lat: 40.2, lng: -74 }, interval: iv("09:00", "10:00") };
    const input = mk([prev]);
    input.busy = [busy("a", "09:00", "10:00")];
    // prev->job is 0.1 deg = 20 min, so earliest start is 10:20 -> grid 10:30
    const out = computeSlots(input);
    expect(labels([out[0].start])).toEqual(["10:30"]);
    expect(out[0].travelBeforeMinutes).toBe(20);
    expect(explainSlot(input, at("10:15"), "a")).toEqual(["TRAVEL"]);
  });

  it("requires the gap before the next job to hold the travel time", () => {
    const next = { staffId: "a", point: { lat: 40.2, lng: -74 }, interval: iv("12:00", "13:00") };
    const input = mk([next]);
    input.busy = [busy("a", "12:00", "13:00")];
    // 60 min service must end by 11:40
    expect(explainSlot(input, at("10:30"), "a")).toEqual([]);
    expect(explainSlot(input, at("10:45"), "a")).toEqual(["TRAVEL"]);
  });

  it("rejects when a single leg exceeds maxTravelMinutes", () => {
    const input = mk();
    input.travel!.staffBase.a = { ...base, maxTravelMinutes: 15 };
    expect(computeSlots(input)).toEqual([]);
    expect(explainSlot(input, at("10:00"), "a")).toEqual(["TRAVEL"]);
  });

  it("rejects when travel data for the staff member is missing", () => {
    const input = mk();
    input.travel!.staffBase = {};
    expect(explainSlot(input, at("10:00"), "a")).toEqual(["TRAVEL"]);
    expect(computeSlots({ ...input, travel: undefined })).toEqual([]);
  });

  it("ignores neighbors of other staff and travel for in-studio services", () => {
    const input = mk([{ staffId: "z", point: { lat: 0, lng: 0 }, interval: iv("09:00", "17:00") }]);
    expect(computeSlots(input).length).toBeGreaterThan(0);
    input.service.locationType = "in_studio";
    const slot = computeSlots(input)[0];
    expect(slot.travelBeforeMinutes).toBeUndefined();
    expect(slot.arrivalWindow).toBeUndefined();
  });

  it("a neighbor job overlapping the span is a TRAVEL reject", () => {
    const input = mk([{ staffId: "a", point: job, interval: iv("10:00", "11:00") }]);
    expect(explainSlot(input, at("10:30"), "a")).toEqual(["TRAVEL"]);
  });

  it("adds the staff buffer to the gap after the previous job", () => {
    const prev = { staffId: "a", point: { lat: 40.2, lng: -74 }, interval: iv("09:00", "10:00") };
    const input = mk([prev]);
    input.busy = [busy("a", "09:00", "10:00")];
    input.travel!.staffBase.a = { ...base, bufferMinutes: 10 };
    // 20 min travel + 10 min buffer -> earliest start 10:30
    expect(explainSlot(input, at("10:15"), "a")).toEqual(["TRAVEL"]);
    expect(explainSlot(input, at("10:30"), "a")).toEqual([]);
    expect(computeSlots(input)[0].travelBeforeMinutes).toBe(20);
  });

  it("adds the staff buffer to the gap before the next job", () => {
    const next = { staffId: "a", point: { lat: 40.2, lng: -74 }, interval: iv("12:00", "13:00") };
    const input = mk([next]);
    input.busy = [busy("a", "12:00", "13:00")];
    input.travel!.staffBase.a = { ...base, bufferMinutes: 15 };
    // 60 min service + 20 min travel + 15 min buffer must end by 11:25 -> 10:15 is the last start
    expect(explainSlot(input, at("10:15"), "a")).toEqual([]);
    expect(explainSlot(input, at("10:30"), "a")).toEqual(["TRAVEL"]);
  });

  it("uses arrivalWindowMinutes for the window; 0 means no window", () => {
    const input = mk();
    input.travel!.arrivalWindowMinutes = 60;
    const [one] = computeSlots(input);
    expect(one.arrivalWindow!.end.getTime() - one.start.getTime()).toBe(3600_000);
    input.travel!.arrivalWindowMinutes = 0;
    const [none] = computeSlots(input);
    expect(none.arrivalWindow).toBeUndefined();
    expect(none.travelBeforeMinutes).toBe(20);
  });
});

describe("flex (processing-gap double booking)", () => {
  const host = (extra: Partial<ReturnType<typeof busy>> = {}) =>
    busy("a", "09:00", "10:15", "appointment", {
      appointmentId: "host",
      processingGaps: [iv("09:45", "10:15")],
      ...extra,
    });
  const flexInput = (items: ReturnType<typeof busy>[], total = 30) => {
    const input = makeInput({ hours: weekly("a", "09:00", "12:00"), busy: items });
    input.service.totalMinutes = total;
    input.rules.allowFlex = true;
    return input;
  };

  it("offers a flex slot at the start of a processing gap", () => {
    const slots = computeSlots(flexInput([host()]));
    const flex = slots.filter((s) => s.isFlex);
    expect(flex).toHaveLength(1);
    expect(labels([flex[0].start])).toEqual(["09:45"]);
    expect(flex[0].hostAppointmentId).toBe("host");
    expect(slots.filter((s) => !s.isFlex).every((s) => s.hostAppointmentId === undefined)).toBe(true);
  });

  it("is off when allowFlex is false", () => {
    const input = flexInput([host()]);
    input.rules.allowFlex = false;
    expect(computeSlots(input).some((s) => s.isFlex)).toBe(false);
    expect(explainSlot(input, at("09:45"), "a")).toEqual(["BUSY_APPOINTMENT"]);
  });

  it("only at the gap start, never later inside the gap (legacy)", () => {
    const input = flexInput([host()], 15);
    const flex = computeSlots(input).filter((s) => s.isFlex);
    expect(labels(flex.map((s) => s.start))).toEqual(["09:45"]);
    expect(explainSlot(input, at("10:00"), "a")).toEqual(["BUSY_APPOINTMENT"]);
  });

  it("requires the whole service to fit inside the gap", () => {
    expect(computeSlots(flexInput([host()], 45)).some((s) => s.isFlex)).toBe(false);
  });

  it("at most one flex child per host", () => {
    const child = busy("a", "09:45", "10:15", "appointment", { appointmentId: "kid", flexHostId: "host" });
    const input = flexInput([host(), child]);
    expect(computeSlots(input).some((s) => s.isFlex)).toBe(false);
    expect(explainSlot(input, at("09:45"), "a")).toContain("BUSY_APPOINTMENT");
  });

  it("existing flex children of other hosts do not block a new flex", () => {
    const host2 = busy("a", "10:30", "11:45", "appointment", {
      appointmentId: "host2",
      processingGaps: [iv("11:15", "11:45")],
    });
    const child2 = busy("a", "11:15", "11:45", "appointment", { appointmentId: "kid2", flexHostId: "host2" });
    const flex = computeSlots(flexInput([host(), host2, child2])).filter((s) => s.isFlex);
    expect(labels(flex.map((s) => s.start))).toEqual(["09:45"]);
  });

  it("another real appointment inside the gap blocks flex", () => {
    const other = busy("a", "10:00", "10:30", "appointment", { appointmentId: "o" });
    const input = flexInput([host({ processingGaps: [iv("09:45", "10:15")] }), other]);
    expect(computeSlots(input).some((s) => s.isFlex)).toBe(false);
  });

  it("a block, external or class inside the gap blocks flex (legacy ignored them)", () => {
    for (const kind of ["block", "external", "class", "task"] as const) {
      const input = flexInput([host(), busy("a", "10:00", "10:10", kind)]);
      expect(computeSlots(input).some((s) => s.isFlex), kind).toBe(false);
    }
  });

  it("flex still obeys resources and booking windows", () => {
    const input = flexInput([host()]);
    input.rules.bookingWindows = { a: [{ opensAt: at("10:00"), closesAt: at("12:00") }] };
    expect(computeSlots(input).some((s) => s.isFlex)).toBe(false);
  });
});

describe("any-staff selection", () => {
  const two = (over: Partial<EngineInput> = {}) =>
    makeInput({
      candidateStaffIds: ["a", "b"],
      anyStaff: true,
      hours: [...weekly("a", "09:00", "11:00"), ...weekly("b", "09:00", "11:00")],
      ...over,
    });

  it("returns every staff member's slots when anyStaff is false", () => {
    const slots = computeSlots(two({ anyStaff: false }));
    expect(slots).toHaveLength(10);
    expect(slots.slice(0, 2).map((s) => s.staffId)).toEqual(["a", "b"]);
  });

  it("ties go to candidateStaffIds order", () => {
    const slots = computeSlots(two());
    expect(slots).toHaveLength(5);
    expect(new Set(slots.map((s) => s.staffId))).toEqual(new Set(["a"]));
    const flipped = computeSlots(two({ candidateStaffIds: ["b", "a"] }));
    expect(new Set(flipped.map((s) => s.staffId))).toEqual(new Set(["b"]));
  });

  it("chooses the lowest dayLoad", () => {
    const slots = computeSlots(two({ dayLoad: { a: 3, b: 1 } }));
    expect(new Set(slots.map((s) => s.staffId))).toEqual(new Set(["b"]));
  });

  it("falls back to the other staff member when the preferred one is busy", () => {
    const slots = computeSlots(two({ dayLoad: { a: 3, b: 1 }, busy: [busy("b", "09:00", "09:45")] }));
    // b (lower load) is busy until 09:45, so a covers 09:00-09:30 and b takes over after
    expect(slots.map((s) => s.staffId)).toEqual(["a", "a", "a", "b", "b"]);
  });

  it("dedupes repeated candidate ids", () => {
    const input = two({ candidateStaffIds: ["a", "a", "b"], anyStaff: false });
    expect(computeSlots(input)).toHaveLength(10);
  });
});

describe("DST in America/New_York", () => {
  const dayInput = (day: string, start: string, end: string) => {
    const input = makeInput({ day, hours: weekly("a", start, end) });
    input.rules.now = new Date("2026-01-01T00:00:00Z");
    input.rules.maxAdvanceDays = 365;
    return input;
  };

  it("spring forward (2026-03-08): 00:00-06:00 is only 5 real hours", () => {
    const slots = computeSlots(dayInput("2026-03-08", "00:00", "06:00"));
    expect(slots).toHaveLength(17);
    expect(slots[0].start.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(slots.at(-1)!.start.toISOString()).toBe("2026-03-08T09:00:00.000Z");
    expect(labels(slots.map((s) => s.start))).not.toContain("02:00");
    expect(labels(slots.map((s) => s.start))).toContain("03:00");
    // starts are exactly 15 real minutes apart across the jump
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].start.getTime() - slots[i - 1].start.getTime()).toBe(900_000);
    }
  });

  it("spring forward: a service across the gap occupies real elapsed time", () => {
    const input = dayInput("2026-03-08", "00:00", "04:00");
    input.service.totalMinutes = 120;
    // real window 05:00Z..08:00Z = 3h -> starts 00:00..01:00 EST/EDT-adjusted
    const slots = computeSlots(input);
    expect(slots).toHaveLength(5);
    expect(slots.at(-1)!.end.toISOString()).toBe("2026-03-08T08:00:00.000Z");
  });

  it("fall back (2026-11-01): 00:00-06:00 is 7 real hours", () => {
    const slots = computeSlots(dayInput("2026-11-01", "00:00", "06:00"));
    expect(slots).toHaveLength(25);
    expect(slots[0].start.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(slots.at(-1)!.start.toISOString()).toBe("2026-11-01T10:00:00.000Z");
    const l = labels(slots.map((s) => s.start));
    expect(l.filter((x) => x === "01:00")).toHaveLength(2); // the repeated hour
  });

  it("ordinary hours keep their wall-clock position on both DST days", () => {
    const spring = computeSlots(dayInput("2026-03-08", "09:00", "10:00"));
    expect(spring[0].start.toISOString()).toBe("2026-03-08T13:00:00.000Z"); // EDT
    const fall = computeSlots(dayInput("2026-11-01", "09:00", "10:00"));
    expect(fall[0].start.toISOString()).toBe("2026-11-01T14:00:00.000Z"); // EST
  });

  it("busy items in absolute time interact correctly with the repeated hour", () => {
    const input = dayInput("2026-11-01", "00:00", "03:00");
    // busy during the second 01:00-02:00 (05:00Z..06:00Z is first; 06:00Z..07:00Z second)
    input.busy = [
      { staffId: "a", kind: "block", interval: { start: new Date("2026-11-01T06:00:00Z"), end: new Date("2026-11-01T07:00:00Z") } },
    ];
    const out = computeSlots(input).map((s) => s.start.toISOString());
    expect(out).toContain("2026-11-01T05:00:00.000Z"); // first 01:00
    expect(out).not.toContain("2026-11-01T06:15:00.000Z");
    expect(out).not.toContain("2026-11-01T06:00:00.000Z");
    expect(out).toContain("2026-11-01T07:00:00.000Z");
  });

  it("overlapping windows at different locations (DST collapse) keep per-window grids", () => {
    // 01:55-02:10 resolves to 01:55 EST - 03:10 EDT (02:10 does not exist), which overlaps
    // the 03:00-05:25 window at another location. Each window anchors its own 15-minute grid.
    const input = dayInput("2026-03-08", "00:00", "00:00");
    input.hours = [
      { staffId: "a", dayOfWeek: 0, start: "01:55", end: "02:10", locationId: null },
      { staffId: "a", dayOfWeek: 0, start: "03:00", end: "05:25", locationId: "L2" },
    ];
    input.service.totalMinutes = 5;
    const at0710 = new Date("2026-03-08T07:10:00Z"); // 03:10 EDT: window 1's end, not on window 2's grid
    expect(computeSlots(input).map((s) => s.start.getTime())).not.toContain(at0710.getTime());
    expect(computeSlots(input)[0].start.toISOString()).toBe("2026-03-08T06:55:00.000Z");
    // explainSlot only checks fit, so the off-grid start is bookable there; it is simply not offered.
    expect(explainSlot(input, at0710, "a")).toEqual([]);
  });

  it("maxAdvanceDays works across the DST change", () => {
    const input = dayInput("2026-03-09", "09:00", "10:00");
    input.rules.now = new Date("2026-03-07T20:00:00-05:00");
    input.rules.maxAdvanceDays = 2;
    expect(computeSlots(input)).toHaveLength(1);
    input.rules.maxAdvanceDays = 1;
    expect(computeSlots(input)).toHaveLength(0);
  });
});

describe("output ordering", () => {
  it("sorts by start then candidate order", () => {
    const input = makeInput({
      candidateStaffIds: ["b", "a"],
      hours: [...weekly("a", "09:00", "10:30"), ...weekly("b", "09:15", "10:30")],
    });
    const out = computeSlots(input).map((s) => `${labels([s.start])[0]}${s.staffId}`);
    expect(out).toEqual(["09:00a", "09:15b", "09:15a", "09:30b", "09:30a"]);
  });
});

/**
 * Each RejectReason has at least one scenario here; the final test enforces it.
 */
describe("explainSlot covers every RejectReason", () => {
  const ALL: RejectReason[] = [
    "OUTSIDE_HOURS", "CLOSED_DAY", "BUSY_APPOINTMENT", "BUSY_BLOCK", "BUSY_EXTERNAL",
    "BUSY_CLASS", "RESOURCE_UNAVAILABLE", "TOO_SOON", "TOO_FAR", "TRAVEL", "WINDOW_CLOSED",
  ];
  const cases: [RejectReason, () => EngineInput, string][] = [
    ["OUTSIDE_HOURS", () => makeInput(), "08:30"],
    ["OUTSIDE_HOURS", () => makeInput(), "16:15"],
    ["CLOSED_DAY", () => makeInput({ hours: [] }), "10:00"],
    ["BUSY_APPOINTMENT", () => makeInput({ busy: [busy("a", "10:00", "11:00")] }), "10:30"],
    ["BUSY_BLOCK", () => makeInput({ busy: [busy("a", "10:00", "11:00", "block")] }), "10:30"],
    ["BUSY_EXTERNAL", () => makeInput({ busy: [busy("a", "10:00", "11:00", "external")] }), "10:30"],
    ["BUSY_CLASS", () => makeInput({ busy: [busy("a", "10:00", "11:00", "class")] }), "10:30"],
    [
      "RESOURCE_UNAVAILABLE",
      () => {
        const i = makeInput({ resources: [] });
        i.service.resourceNeeds = [{ kind: "room", quantity: 1, offsetMinutes: 0, durationMinutes: null }];
        return i;
      },
      "10:00",
    ],
    [
      "TOO_SOON",
      () => {
        const i = makeInput();
        i.rules.now = at("09:50");
        i.rules.minNoticeMinutes = 30;
        return i;
      },
      "10:00",
    ],
    [
      "TOO_FAR",
      () => {
        const i = makeInput();
        i.rules.maxAdvanceDays = 3;
        return i;
      },
      "10:00",
    ],
    [
      "TRAVEL",
      () => {
        const i = makeInput();
        i.service.locationType = "on_site";
        return i;
      },
      "10:00",
    ],
    [
      "WINDOW_CLOSED",
      () => {
        const i = makeInput();
        i.rules.bookingWindows = { a: [] };
        return i;
      },
      "10:00",
    ],
  ];

  it.each(cases)("%s", (reason, build, time) => {
    expect(explainSlot(build(), at(time), "a")).toContain(reason);
  });

  it("the table covers all reasons", () => {
    expect(new Set(cases.map((c) => c[0]))).toEqual(new Set(ALL));
  });

  it("returns [] for a bookable start", () => {
    expect(explainSlot(makeInput(), at("10:00"), "a")).toEqual([]);
  });

  it("combines independent reasons, in canonical order", () => {
    const i = makeInput({ busy: [busy("a", "08:00", "09:30", "block")] });
    i.rules.bookingWindows = { a: [] };
    expect(explainSlot(i, at("08:30"), "a")).toEqual(["OUTSIDE_HOURS", "BUSY_BLOCK", "WINDOW_CLOSED"]);
  });

  it("explains for a staff member that is not a candidate", () => {
    expect(explainSlot(makeInput(), at("10:00"), "ghost")).toEqual(["CLOSED_DAY"]);
  });

  it("uses the timezone given in the rules", () => {
    const i = makeInput();
    expect(TZ).toBe(i.rules.timezone);
  });
});

describe("performance", () => {
  it("computes one day for 10 staff with 200 busy items quickly", () => {
    const staff = Array.from({ length: 10 }, (_, i) => `s${i}`);
    const kinds = ["appointment", "block", "external"] as const;
    const items = staff.flatMap((id, si) =>
      Array.from({ length: 20 }, (_, k) => {
        const startMin = 9 * 60 + ((k * 23 + si * 7) % 440);
        const fmt = (m: number) =>
          `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
        return busy(id, fmt(startMin), fmt(Math.min(startMin + 10 + (k % 3) * 5, 17 * 60)), kinds[k % 3]);
      }),
    );
    expect(items).toHaveLength(200);
    const input = makeInput({
      candidateStaffIds: staff,
      anyStaff: false,
      hours: staff.flatMap((id) => weekly(id, "08:00", "18:00")),
      busy: items,
      resources: [
        { id: "r1", kind: "room", locationId: null, capacity: 1 },
        { id: "r2", kind: "room", locationId: null, capacity: 1 },
        { id: "r3", kind: "room", locationId: null, capacity: 1 },
      ],
    });
    input.service.resourceNeeds = [{ kind: "room", quantity: 1, offsetMinutes: 0, durationMinutes: null }];
    input.service.bufferAfterMinutes = 10;
    input.rules.allowFlex = true;

    computeSlots(input); // warm up the JIT and Intl caches
    const runs: number[] = [];
    let count = 0;
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      count = computeSlots(input).length;
      runs.push(performance.now() - t0);
    }
    const best = Math.min(...runs);
    console.log(
      `[perf] 10 staff x 200 busy items: best ${best.toFixed(2)} ms, runs ${runs.map((r) => r.toFixed(2)).join("/")} ms, ${count} slots`,
    );
    expect(count).toBeGreaterThan(0);
    expect(best).toBeLessThan(200);
  });
});

describe("staffWindows", () => {
  it("returns each split shift as its own window with its location, sorted", () => {
    const input = makeInput({
      hours: [
        { staffId: "a", dayOfWeek: 3, start: "14:00", end: "17:00", locationId: "L2" },
        { staffId: "a", dayOfWeek: 3, start: "09:00", end: "12:00", locationId: "L1" },
        { staffId: "b", dayOfWeek: 3, start: "08:00", end: "09:00", locationId: "L1" },
      ],
    });
    expect(staffWindows(input, "a")).toEqual([
      { start: at("09:00"), end: at("12:00"), locationId: "L1" },
      { start: at("14:00"), end: at("17:00"), locationId: "L2" },
    ]);
  });

  it("uses the override instead of the weekly hours, and is empty when closed", () => {
    const open = makeInput({
      overrides: [{ staffId: "a", date: DAY, intervals: [{ start: "10:00", end: "12:00", locationId: null }] }],
    });
    expect(staffWindows(open, "a")).toEqual([{ start: at("10:00"), end: at("12:00"), locationId: null }]);
    const closed = makeInput({ overrides: [{ staffId: "a", date: DAY, intervals: [] }] });
    expect(staffWindows(closed, "a")).toEqual([]);
  });
});
