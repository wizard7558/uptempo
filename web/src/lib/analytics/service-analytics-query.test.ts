// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import { computeServiceAnalytics } from "./service-metrics";
import {
  FIXTURE_EXPECTED,
  FIXTURE_RANGE,
  toTableRow,
} from "./service-metrics-fixture";

// Integration test (run via `npm run test:db`); skipped when DATABASE_URL is unset.
const DATABASE_URL = process.env.DATABASE_URL;
const itDb = DATABASE_URL ? it : it.skip;

const slug = `sa${Date.now()}${Math.floor(Math.random() * 1000)}`;

afterAll(async () => {
  if (!DATABASE_URL) return;
  const { dropTenantSchema } = await import("@/lib/tenant/provision");
  try {
    await dropTenantSchema(slug);
  } catch {
    // ignore cleanup errors
  }
});

const id = (kind: string, n: number) =>
  `00000000-0000-4000-8000-${kind}${String(n).padStart(10, "0")}`;
const S = { S1: id("0a", 1), S2: id("0a", 2) };
const SV = { SV1: id("0b", 1), SV2: id("0b", 2) };
const C = { C1: id("0c", 1), C2: id("0c", 2), C3: id("0c", 3) };
const L1 = id("0d", 1);
const A = Object.fromEntries(
  ["A0", "A1", "A2", "A3", "A4", "A5", "A6"].map((k, i) => [k, id("0e", i)]),
) as Record<string, string>;
const nameOf = (uuid: string) => Object.entries(A).find(([, v]) => v === uuid)?.[0];

describe("service analytics query (integration)", () => {
  itDb("loads the fixture and reproduces the expected table", async () => {
    const { provisionTenantSchema } = await import("@/lib/tenant/provision");
    const { publicDb } = await import("@/lib/db");
    const { withTenantDb } = await import("@/lib/db/tenant");
    const { sql } = await import("drizzle-orm");
    const { loadServiceAnalyticsInputs } = await import("./service-analytics-query");

    await provisionTenantSchema({ name: "SA Test", slug });
    const q = `"tenant_${slug}"`;
    const run = (text: string) => publicDb.execute(sql.raw(text));

    await run(`INSERT INTO ${q}.clients (id, name) VALUES ('${C.C1}','C1'),('${C.C2}','C2'),('${C.C3}','C3')`);
    await run(`INSERT INTO ${q}.locations (id, name) VALUES ('${L1}','Main')`);
    await run(`INSERT INTO ${q}.staff (id, display_name) VALUES ('${S.S1}','Avery'),('${S.S2}','Blake')`);
    await run(`INSERT INTO ${q}.services (id, name, default_duration_minutes, price_cents) VALUES ('${SV.SV1}','Cut',60,5000),('${SV.SV2}','Color',120,12000)`);

    const appt = (k: string, staff: string, client: string, start: string, status: string, snap: string | null) =>
      run(
        `INSERT INTO ${q}.appointments (id, staff_id, client_id, location_id, during, status, client_status_at_booking) VALUES ('${A[k]}','${staff}','${client}','${L1}','[${start}+00,${start.slice(0, 11)}${String(Number(start.slice(11, 13)) + 3).padStart(2, "0")}:00+00)','${status}',${snap ? `'${snap}'` : "NULL"})`,
      );
    await appt("A0", S.S1, C.C2, "2030-02-01 15:00", "completed", null);
    await appt("A1", S.S1, C.C1, "2030-03-02 15:00", "completed", "new");
    await appt("A2", S.S1, C.C1, "2030-03-20 15:00", "confirmed", "repeat");
    await appt("A3", S.S2, C.C2, "2030-03-05 16:00", "completed", null);
    await appt("A4", S.S2, C.C3, "2030-03-06 16:00", "no_show", "new");
    await appt("A5", S.S1, C.C3, "2030-03-07 15:00", "cancelled", "repeat");
    await appt("A6", S.S1, C.C2, "2030-04-10 15:00", "confirmed", null);

    const line = (k: string, sv: string, price: string, mins: number) =>
      run(`INSERT INTO ${q}.appointment_services (appointment_id, service_id, duration_minutes, price_charged_cents) VALUES ('${A[k]}','${sv}',${mins},${price})`);
    await line("A1", SV.SV1, "5000", 60);
    await line("A2", SV.SV1, "5000", 60);
    await line("A3", SV.SV2, "11000", 90);
    await line("A3", SV.SV1, "NULL", 30);
    await line("A4", SV.SV2, "12000", 120);
    await line("A5", SV.SV1, "5000", 60);

    const { lines, history } = await withTenantDb(slug, (db, t) =>
      loadServiceAnalyticsInputs(db, t, FIXTURE_RANGE),
    );
    expect(lines).toHaveLength(5);
    expect(new Set(lines.map((l) => nameOf(l.appointmentId)))).toEqual(
      new Set(["A1", "A2", "A3", "A4"]),
    );
    expect(new Set(history.map((h) => nameOf(h.appointmentId)))).toEqual(
      new Set(["A0", "A1", "A2", "A3", "A4", "A6"]),
    );

    const out = computeServiceAnalytics(lines, history);
    const computed = {
      byService: out.byService.map(toTableRow),
      byStaff: out.byStaff.map(toTableRow),
      totals: toTableRow(out.totals),
    };
    expect(computed).toEqual(FIXTURE_EXPECTED);
  }, 90000);
});
