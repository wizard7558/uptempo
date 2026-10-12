import { describe, it, expect } from "vitest";
import { deriveGroupKind } from "./group-kind";

const m = (clientId: string, serviceIds: string[], startTime: string) => ({ clientId, serviceIds, startTime });

describe("deriveGroupKind", () => {
  it("crew: one client, same services, same start", () => {
    expect(
      deriveGroupKind([m("c1", ["x", "y"], "2026-06-17T14:00Z"), m("c1", ["y", "x"], "2026-06-17T14:00:00.000Z")]),
    ).toBe("crew");
  });
  it("multi_tech: one client, different services", () => {
    expect(deriveGroupKind([m("c1", ["x"], "2026-06-17T14:00Z"), m("c1", ["y"], "2026-06-17T14:00Z")])).toBe(
      "multi_tech",
    );
  });
  it("multi_tech: one client, same services, different starts", () => {
    expect(deriveGroupKind([m("c1", ["x"], "2026-06-17T14:00Z"), m("c1", ["x"], "2026-06-17T15:00Z")])).toBe(
      "multi_tech",
    );
  });
  it("couples: two different clients", () => {
    expect(deriveGroupKind([m("c1", ["x"], "2026-06-17T14:00Z"), m("c2", ["x"], "2026-06-17T14:00Z")])).toBe(
      "couples",
    );
  });
  it("party: three or more clients, even if two share a client", () => {
    expect(
      deriveGroupKind([
        m("c1", ["x"], "2026-06-17T14:00Z"),
        m("c2", ["x"], "2026-06-17T14:00Z"),
        m("c2", ["x"], "2026-06-17T14:00Z"),
      ]),
    ).toBe("party");
  });
});
