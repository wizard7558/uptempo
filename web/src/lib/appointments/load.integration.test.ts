// @vitest-environment node
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import type { ScratchTenant } from "@/lib/scheduling/db-fixtures";

// The loader must work with no request scope and no session: nothing from
// next/headers, the tenant context, or the auth layer is mocked or needed.
vi.mock("next/headers", () => ({
  headers: async () => {
    throw new Error("the loader must not read request headers");
  },
}));

const itDb = process.env.DATABASE_URL ? it : it.skip;

let a: ScratchTenant;
let b: ScratchTenant;
let appointmentId = "";

afterAll(async () => {
  if (a) await a.drop();
  if (b) await b.drop();
});

describe("loadAppointmentForTenant against real tenant schemas", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) return;
    const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
    a = await scratchTenant("loada");
    b = await scratchTenant("loadb");
    const s = `"${a.schema}"`;
    const id = async (sqlText: string) => String((await a.run(sqlText))[0].id);
    const location = await id(`select id from ${s}.locations order by created_at limit 1`);
    const client = await id(
      `insert into ${s}.clients (name, email) values ('Casey', 'casey@example.test') returning id`,
    );
    const staff = await id(`insert into ${s}.staff (display_name) values ('Pat') returning id`);
    const service = await id(
      `insert into ${s}.services (name, default_duration_minutes) values ('Haircut', 30) returning id`,
    );
    appointmentId = await id(
      `insert into ${s}.appointments (staff_id, client_id, location_id, during, status)
       values ('${staff}', '${client}', '${location}',
         tstzrange('2026-10-20T15:00:00Z','2026-10-20T15:30:00Z','[)'), 'confirmed') returning id`,
    );
    await a.run(
      `insert into ${s}.appointment_services (appointment_id, service_id, duration_minutes, price_charged_cents)
       values ('${appointmentId}', '${service}', 30, 3500)`,
    );
  }, 180_000);

  itDb("returns the client, services, and times for the named tenant", async () => {
    const { loadAppointmentForTenant } = await import("./load");
    const appt = await loadAppointmentForTenant(a.slug, appointmentId);
    expect(appt).toMatchObject({
      id: appointmentId,
      status: "confirmed",
      client: { name: "Casey", email: "casey@example.test" },
      services: [{ serviceName: "Haircut", durationMinutes: 30 }],
    });
    expect(appt?.start.toISOString()).toBe("2026-10-20T15:00:00.000Z");
  });

  itDb("returns null when the appointment belongs to a different tenant", async () => {
    const { loadAppointmentForTenant } = await import("./load");
    await expect(loadAppointmentForTenant(b.slug, appointmentId)).resolves.toBeNull();
  });
});
