import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getT: vi.fn(async () => (key: string) => key),
  loadAppointmentForTenant: vi.fn(async () =>
    null as null | { id: string; staffId: string; services: { serviceId: string }[] },
  ),
  redirect: vi.fn(() => undefined),
  resolveTenantSlugForAppointment: vi.fn(async () => null as string | null),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/terms/server", () => ({ getT: mocks.getT }));
vi.mock("@/lib/appointments/load", () => ({ loadAppointmentForTenant: mocks.loadAppointmentForTenant }));
vi.mock("@/lib/tenant/registry", () => ({
  resolveTenantSlugForAppointment: mocks.resolveTenantSlugForAppointment,
}));

import ReschedulePage from "./page";
import { createActionToken } from "@/lib/email/tokens";

beforeEach(() => vi.clearAllMocks());

describe("reschedule link redirect", () => {
  it("uses the neutral staff key and preserves the appointment and services", async () => {
    mocks.resolveTenantSlugForAppointment.mockResolvedValue("fade-co");
    mocks.loadAppointmentForTenant.mockResolvedValue({
      id: "appointment-42",
      staffId: "staff-7",
      services: [{ serviceId: "service-cut" }, { serviceId: "service-color" }],
    });
    const token = createActionToken("appointment-42", "reschedule");

    await ReschedulePage({ params: Promise.resolve({ token }) });

    expect(mocks.resolveTenantSlugForAppointment).toHaveBeenCalledWith("appointment-42");
    expect(mocks.loadAppointmentForTenant).toHaveBeenCalledWith("fade-co", "appointment-42");
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(
      "/book/fade-co?reschedule=appointment-42&staff=staff-7&services=service-cut,service-color",
    );
  });

  it.each([
    { description: "an invalid token", token: "not-a-signed-token" },
    { description: "a token for another action", token: createActionToken("appointment-42", "cancel") },
  ])("does not resolve, load, or redirect for $description", async ({ token }) => {
    await ReschedulePage({ params: Promise.resolve({ token }) });

    expect(mocks.resolveTenantSlugForAppointment).not.toHaveBeenCalled();
    expect(mocks.loadAppointmentForTenant).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("does not redirect when the appointment is missing", async () => {
    mocks.resolveTenantSlugForAppointment.mockResolvedValue("fade-co");
    mocks.loadAppointmentForTenant.mockResolvedValue(null);
    const token = createActionToken("missing-appointment", "reschedule");

    await ReschedulePage({ params: Promise.resolve({ token }) });

    expect(mocks.resolveTenantSlugForAppointment).toHaveBeenCalledWith("missing-appointment");
    expect(mocks.loadAppointmentForTenant).toHaveBeenCalledWith("fade-co", "missing-appointment");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
