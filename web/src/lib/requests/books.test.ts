import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/tenant", () => ({ withTenantDb: vi.fn() }));

import {
  anyStaffOpen,
  earliestOpening,
  isStaffOpen,
  openStaffIds,
  type BooksStaff,
  type RequestWindow,
} from "./books";

const NOW = new Date("2026-03-10T12:00:00Z");
const d = (s: string) => new Date(s);

const open: BooksStaff = { id: "a", mode: "open" };
const closed: BooksStaff = { id: "b", mode: "closed" };
const windowed: BooksStaff = { id: "c", mode: "windows" };

const own: RequestWindow = { staffId: "c", opensAt: d("2026-03-01T00:00:00Z"), closesAt: d("2026-03-16T00:00:00Z") };
const later: RequestWindow = { staffId: "c", opensAt: d("2026-04-01T00:00:00Z"), closesAt: d("2026-04-05T00:00:00Z") };
const everyone: RequestWindow = { staffId: null, opensAt: d("2026-03-20T00:00:00Z"), closesAt: d("2026-03-25T00:00:00Z") };
const other: RequestWindow = { staffId: "zzz", opensAt: d("2026-03-01T00:00:00Z"), closesAt: d("2026-03-30T00:00:00Z") };

describe("isStaffOpen (mode matrix)", () => {
  it("open is always open, with or without windows", () => {
    expect(isStaffOpen(open, [], NOW)).toBe(true);
    expect(isStaffOpen(open, [later], NOW)).toBe(true);
  });

  it("closed is never open, even inside a window", () => {
    expect(isStaffOpen(closed, [], NOW)).toBe(false);
    expect(isStaffOpen({ id: "b", mode: "closed" }, [{ ...own, staffId: "b" }], NOW)).toBe(false);
  });

  it("windows is open only inside one of their own windows", () => {
    expect(isStaffOpen(windowed, [], NOW)).toBe(false);
    expect(isStaffOpen(windowed, [own], NOW)).toBe(true);
    expect(isStaffOpen(windowed, [later], NOW)).toBe(false);
    expect(isStaffOpen(windowed, [other], NOW)).toBe(false);
  });

  it("a business-wide window opens everyone on windows", () => {
    expect(isStaffOpen(windowed, [everyone], d("2026-03-21T00:00:00Z"))).toBe(true);
    expect(isStaffOpen(windowed, [everyone], NOW)).toBe(false);
  });

  it("a window opens at its start and closes at its end", () => {
    expect(isStaffOpen(windowed, [own], own.opensAt)).toBe(true);
    expect(isStaffOpen(windowed, [own], own.closesAt)).toBe(false);
  });
});

describe("anyStaffOpen / openStaffIds", () => {
  it("is open when at least one person is", () => {
    expect(anyStaffOpen([closed, windowed], [], NOW)).toBe(false);
    expect(anyStaffOpen([closed, windowed], [own], NOW)).toBe(true);
    expect(anyStaffOpen([closed, open], [], NOW)).toBe(true);
  });

  it("an empty team has nothing to close", () => {
    expect(anyStaffOpen([], [], NOW)).toBe(true);
  });

  it("lists exactly the open people", () => {
    expect(openStaffIds([open, closed, windowed], [own], NOW)).toEqual(["a", "c"]);
    expect(openStaffIds([open, closed, windowed], [], NOW)).toEqual(["a"]);
  });
});

describe("earliestOpening", () => {
  it("returns the soonest future start among windows-mode people", () => {
    expect(earliestOpening([windowed], [later, own, everyone], NOW)).toEqual(everyone.opensAt);
    expect(earliestOpening([windowed], [later], NOW)).toEqual(later.opensAt);
  });

  it("ignores windows that already started, other people's windows, and non-windows modes", () => {
    expect(earliestOpening([windowed], [own], NOW)).toBeNull();
    expect(earliestOpening([windowed], [other], NOW)).toBeNull();
    expect(earliestOpening([open, closed], [later, everyone], NOW)).toBeNull();
    expect(earliestOpening([], [later], NOW)).toBeNull();
  });
});
