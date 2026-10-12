import { describe, it, expect } from "vitest";
import { areaCovers, checkServiceArea, type AreaRow } from "./service-area";

const zips = (ids: string[], staffId: string | null = null, id = "z"): AreaRow => ({
  id,
  staffId,
  kind: "postal_codes",
  postalCodes: ids,
  centerLat: null,
  centerLng: null,
  radiusKm: null,
});
const radius = (km: number, staffId: string | null = null): AreaRow => ({
  id: "r",
  staffId,
  kind: "radius",
  postalCodes: [],
  centerLat: 40,
  centerLng: -74,
  radiusKm: km,
});
// 1 degree of latitude is about 111.19 km.
const north = (km: number) => ({ lat: 40 + km / 111.195, lng: -74 });

describe("service areas", () => {
  it("matches a ZIP list, including ZIP+4", () => {
    const a = zips(["10001", "10002"]);
    expect(checkServiceArea([a], "10001", null, null)).toBe("ok");
    expect(checkServiceArea([a], "10002-4455", null, null)).toBe("ok");
    expect(checkServiceArea([a], "90210", null, null)).toBe("out_of_area");
  });

  it("radius: 9.9 km is in, 10.1 km is out of a 10 km area", () => {
    const a = radius(10);
    expect(checkServiceArea([a], "x", north(9.9), null)).toBe("ok");
    expect(checkServiceArea([a], "x", north(10.1), null)).toBe("out_of_area");
  });

  it("radius areas never cover an address with no point", () => {
    expect(areaCovers(radius(500), "10001", null)).toBe(false);
  });

  it("ignores another staff member's area", () => {
    const mine = zips(["10001"], "s1");
    expect(checkServiceArea([mine], "10001", null, "s2")).toBe("out_of_area");
    expect(checkServiceArea([mine], "10001", null, "s1")).toBe("ok");
    expect(checkServiceArea([mine], "10001", null, null)).toBe("ok");
  });

  it("business-wide areas apply to every staff member", () => {
    expect(checkServiceArea([zips(["10001"])], "10001", null, "s9")).toBe("ok");
  });

  it("allows everything when there are no areas", () => {
    expect(checkServiceArea([], "90210", null, null)).toBe("ok");
  });
});
