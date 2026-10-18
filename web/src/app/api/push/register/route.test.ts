import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getBookingSession: vi.fn(),
  getTenantSlugForBookingClient: vi.fn(),
  select: vi.fn(),
  setBookingSession: vi.fn(),
  withTenantDb: vi.fn(),
  tenantSlug: null as string | null,
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => args),
}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db", () => ({
  publicDb: { select: mocks.select },
}));
vi.mock("@/lib/db/schema/auth", () => ({
  user: { id: "user.id", tenantSlug: "user.tenantSlug" },
}));
vi.mock("@/lib/booking/session-cookie", () => ({
  getBookingSession: mocks.getBookingSession,
  setBookingSession: mocks.setBookingSession,
}));
vi.mock("@/lib/tenant/registry", () => ({
  getTenantSlugForBookingClient: mocks.getTenantSlugForBookingClient,
}));
vi.mock("@/lib/db/tenant", () => ({
  withTenantDb: mocks.withTenantDb,
}));

beforeEach(() => {
  mocks.getSession.mockReset().mockResolvedValue(null);
  mocks.getBookingSession.mockReset().mockResolvedValue(null);
  mocks.getTenantSlugForBookingClient.mockReset().mockResolvedValue(null);
  mocks.setBookingSession.mockReset();
  mocks.withTenantDb.mockReset();
  mocks.tenantSlug = null;
  mocks.select.mockReset().mockImplementation(() => {
    const query = {
      from: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(async () =>
        mocks.tenantSlug ? [{ tenantSlug: mocks.tenantSlug }] : [],
      ),
    };
    query.from.mockReturnValue(query);
    query.where.mockReturnValue(query);
    return query;
  });
});

async function expectAuthOnly(response: Response, authenticated: boolean) {
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const body = await response.json();
  expect(body).toEqual({ authenticated });
  expect(Object.keys(body)).toEqual(["authenticated"]);
}

describe("GET /api/push/register", () => {
  it("returns false without a user or booking session and exposes no identifiers", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expectAuthOnly(response, false);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.setBookingSession).not.toHaveBeenCalled();
    expect(mocks.withTenantDb).not.toHaveBeenCalled();
  });

  it("confirms only an owner session with a resolved tenant", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "owner-id" } });
    mocks.tenantSlug = "business-tenant";

    const response = await GET();

    expect(response.status).toBe(200);
    await expectAuthOnly(response, true);
    expect(mocks.select).toHaveBeenCalledTimes(1);
    expect(mocks.setBookingSession).not.toHaveBeenCalled();
    expect(mocks.withTenantDb).not.toHaveBeenCalled();
  });

  it("confirms a booking-client cookie only after resolving its tenant", async () => {
    mocks.getBookingSession.mockResolvedValue("client-id");
    mocks.getTenantSlugForBookingClient.mockResolvedValue("business-tenant");

    const response = await GET();

    expect(response.status).toBe(200);
    await expectAuthOnly(response, true);
    expect(mocks.getTenantSlugForBookingClient).toHaveBeenCalledWith("client-id");
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.withTenantDb).not.toHaveBeenCalled();
  });

  it("fails closed without caching when principal resolution fails", async () => {
    mocks.getSession.mockRejectedValue(new Error("session lookup failed"));

    const response = await GET();

    expect(response.status).toBe(503);
    await expectAuthOnly(response, false);
  });
});
