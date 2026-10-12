import { describe, expect, it } from "vitest";
import { MODE_KINDS, MODE_REASONS, failureCodeFor } from "./reasons";

describe("failureCodeFor", () => {
  it("prefers a taken slot over everything else", () => {
    expect(failureCodeFor(["OUTSIDE_HOURS", "BUSY_APPOINTMENT", "BUSY_BLOCK", "TOO_SOON"])).toBe("SLOT_TAKEN");
    expect(failureCodeFor(["BUSY_EXTERNAL"])).toBe("SLOT_TAKEN");
    expect(failureCodeFor(["BUSY_CLASS"])).toBe("SLOT_TAKEN");
  });

  it("then resources, then blocks, then timing", () => {
    expect(failureCodeFor(["RESOURCE_UNAVAILABLE", "BUSY_BLOCK"])).toBe("RESOURCE_TAKEN");
    expect(failureCodeFor(["BUSY_BLOCK", "TOO_SOON"])).toBe("BLOCKED");
    expect(failureCodeFor(["TOO_SOON", "TOO_FAR"])).toBe("TOO_SOON");
    expect(failureCodeFor(["TOO_FAR"])).toBe("TOO_FAR");
  });

  it("reports travel problems after timing and before the fallback", () => {
    expect(failureCodeFor(["TRAVEL"])).toBe("TOO_FAR_TO_TRAVEL");
    expect(failureCodeFor(["OUTSIDE_HOURS", "TRAVEL"])).toBe("TOO_FAR_TO_TRAVEL");
    expect(failureCodeFor(["TOO_FAR", "TRAVEL"])).toBe("TOO_FAR");
    expect(failureCodeFor(["BUSY_APPOINTMENT", "TRAVEL"])).toBe("SLOT_TAKEN");
  });

  it("falls back to staff unavailable", () => {
    expect(failureCodeFor(["CLOSED_DAY"])).toBe("STAFF_UNAVAILABLE");
    expect(failureCodeFor(["OUTSIDE_HOURS"])).toBe("STAFF_UNAVAILABLE");
    expect(failureCodeFor([])).toBe("STAFF_UNAVAILABLE");
  });
});

describe("books closed", () => {
  it("maps a closed window to its own code, below every other reason", () => {
    expect(failureCodeFor(["WINDOW_CLOSED"])).toBe("BOOKS_CLOSED");
    expect(failureCodeFor(["OUTSIDE_HOURS", "WINDOW_CLOSED"])).toBe("BOOKS_CLOSED");
    expect(failureCodeFor(["TOO_SOON", "WINDOW_CLOSED"])).toBe("TOO_SOON");
    expect(failureCodeFor(["BUSY_APPOINTMENT", "WINDOW_CLOSED"])).toBe("SLOT_TAKEN");
  });

  it("only public bookings are limited by the books", () => {
    expect(MODE_REASONS.public).toBeNull();
    for (const mode of ["override", "reschedule", "series"] as const) {
      expect(MODE_REASONS[mode]!.has("WINDOW_CLOSED")).toBe(false);
    }
  });
});

describe("mode filters", () => {
  it("public rejects on every reason", () => {
    expect(MODE_REASONS.public).toBeNull();
  });

  it("override only rejects on blocks and resources", () => {
    expect([...MODE_REASONS.override!].sort()).toEqual(["BUSY_BLOCK", "RESOURCE_UNAVAILABLE"]);
    expect(MODE_KINDS.override).toEqual(["block"]);
  });

  it("reschedule ignores hours, notice and external events", () => {
    const r = MODE_REASONS.reschedule!;
    expect(r.has("BUSY_APPOINTMENT")).toBe(true);
    expect(r.has("BUSY_BLOCK")).toBe(true);
    expect(r.has("OUTSIDE_HOURS")).toBe(false);
    expect(r.has("TOO_SOON")).toBe(false);
    expect(r.has("BUSY_EXTERNAL")).toBe(false);
    expect(MODE_KINDS.reschedule).toEqual(["appointment", "block"]);
  });

  it("series ignores notice and horizon but enforces hours and conflicts", () => {
    const r = MODE_REASONS.series!;
    expect(r.has("OUTSIDE_HOURS")).toBe(true);
    expect(r.has("BUSY_EXTERNAL")).toBe(true);
    expect(r.has("TOO_SOON")).toBe(false);
    expect(r.has("TOO_FAR")).toBe(false);
  });
});
