// @vitest-environment node
import { describe, it, expect, afterAll } from "vitest";

const itDb = process.env.DATABASE_URL ? it : it.skip;

/** Last schema version before the Phase 3 migrations (0047 onward). */
const PHASE3_BASE = 46;

/** postgres.js wraps the driver error ("Failed query"); the constraint name is on the cause. */
async function violates(p: Promise<unknown>, pattern: RegExp) {
  try {
    await p;
  } catch (e) {
    const err = e as { message?: string; cause?: { message?: string } };
    expect(`${err.message} ${err.cause?.message ?? ""}`).toMatch(pattern);
    return;
  }
  throw new Error(`Expected a violation matching ${pattern}`);
}

const slugs: string[] = [];
const makeSlug = (tag: string) => {
  const slug = `p3${tag}${Date.now()}${Math.floor(Math.random() * 1000)}`;
  slugs.push(slug);
  return slug;
};

afterAll(async () => {
  if (!process.env.DATABASE_URL) return;
  const { dropTenantSchema } = await import("../provision");
  for (const slug of slugs) {
    try {
      await dropTenantSchema(slug);
    } catch {
      // Ignore cleanup errors
    }
  }
});

describe("Phase 3 migrations (integration)", () => {
  itDb(
    "fresh@LATEST equals fresh@base + migrate; down returns to base; up again returns to LATEST",
    async () => {
      const { provisionTenantSchema } = await import("../provision");
      const { migrateTenant, rollbackTenant } = await import("./runner");
      const { LATEST_SCHEMA_VERSION } = await import("./index");
      const { schemaFingerprint } = await import("../schema-fingerprint");

      const a = makeSlug("a");
      const b = makeSlug("b");
      await provisionTenantSchema({ name: "P3 A", slug: a });
      await provisionTenantSchema({ name: "P3 B", slug: b, throughVersion: PHASE3_BASE });
      const fpA = await schemaFingerprint(`tenant_${a}`);
      const fpBase = await schemaFingerprint(`tenant_${b}`);
      expect(fpBase).not.toEqual(fpA);

      const up = await migrateTenant(b, PHASE3_BASE);
      expect(up.error).toBeUndefined();
      expect(up.toVersion).toBe(LATEST_SCHEMA_VERSION);
      expect(await schemaFingerprint(`tenant_${b}`)).toEqual(fpA);

      const down = await rollbackTenant(b, LATEST_SCHEMA_VERSION, PHASE3_BASE);
      expect(down.error).toBeUndefined();
      expect(await schemaFingerprint(`tenant_${b}`)).toEqual(fpBase);

      const again = await migrateTenant(b, PHASE3_BASE);
      expect(again.error).toBeUndefined();
      expect(again.toVersion).toBe(LATEST_SCHEMA_VERSION);
      expect(await schemaFingerprint(`tenant_${b}`)).toEqual(fpA);
    },
    120_000,
  );

  itDb(
    "0047 enforces quote, attachment and line item constraints",
    async () => {
      const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
      const t = await scratchTenant("p3q");
      slugs.push(t.slug);
      try {
        const [client] = await t.run(
          `INSERT INTO "${t.schema}".clients (name, email) VALUES ('Q Client', 'q@example.com') RETURNING id`,
        );
        const [req] = await t.run(
          `INSERT INTO "${t.schema}".booking_requests (client_id) VALUES ('${client.id}') RETURNING id`,
        );
        const quote = (status: string, extra = "") =>
          t.run(
            `INSERT INTO "${t.schema}".quotes (request_id, status, access_token${extra ? ", sent_at, valid_until" : ""})
             VALUES ('${req.id}', '${status}', '${crypto.randomUUID()}'${extra ? ", now(), now() + interval '7 days'" : ""})`,
          );

        // Defaults and JSON shape checks on the request itself.
        const [row] = await t.run(
          `SELECT kind, status, answers, preferred_windows FROM "${t.schema}".booking_requests WHERE id = '${req.id}'`,
        );
        expect(row).toMatchObject({ kind: "quote", status: "new", answers: {}, preferred_windows: [] });
        await violates(t.run(`UPDATE "${t.schema}".booking_requests SET status = 'bogus' WHERE id = '${req.id}'`), /booking_requests_status_check/);
        await violates(t.run(`UPDATE "${t.schema}".booking_requests SET answers = '[]'::jsonb WHERE id = '${req.id}'`), /booking_requests_answers_check/);

        // A sent quote must carry sent_at and valid_until.
        await violates(quote("sent"), /quotes_sent_fields_check/);
        // One sent quote per request.
        await quote("sent", "dates");
        await violates(quote("sent", "dates"), /quotes_one_sent_per_request/);
        // Drafts are unlimited, deposit may not exceed subtotal.
        await quote("draft");
        await quote("draft");
        await violates(
          t.run(
            `INSERT INTO "${t.schema}".quotes (request_id, access_token, subtotal_cents, deposit_cents)
             VALUES ('${req.id}', '${crypto.randomUUID()}', 1000, 2000)`,
          ),
          /quotes_amounts_check/,
        );

        // ID documents must stay private; sizes and types are bounded.
        const attach = (kind: string, isPrivate: number, mime = "image/jpeg", size = 100) =>
          t.run(
            `INSERT INTO "${t.schema}".attachments (owner_type, kind, storage_key, mime, size_bytes, is_private, uploaded_by)
             VALUES ('request', '${kind}', 'private/${crypto.randomUUID()}.jpg', '${mime}', ${size}, ${isPrivate}, 'test')`,
          );
        await violates(attach("id_document", 0), /attachments_private_check/);
        await attach("id_document", 1);
        await attach("reference", 0);
        await violates(attach("reference", 1, "text/plain"), /attachments_mime_check/);
        await violates(attach("reference", 1, "image/jpeg", 10485761), /attachments_size_check/);
        await violates(attach("selfie", 1), /attachments_kind_check/);
        const key = `private/${crypto.randomUUID()}.jpg`;
        const dup = () =>
          t.run(
            `INSERT INTO "${t.schema}".attachments (owner_type, kind, storage_key, mime, size_bytes, uploaded_by)
             VALUES ('client', 'reference', '${key}', 'image/png', 10, 'test')`,
          );
        await dup();
        await violates(dup(), /attachments_storage_key_unique/);

        // Line items: service is required (RESTRICT), bounds enforced, cascade on quote delete.
        const [svc] = await t.run(
          `INSERT INTO "${t.schema}".services (name, default_duration_minutes, price_cents) VALUES ('Tattoo', 60, 10000) RETURNING id`,
        );
        const [q] = await t.run(
          `SELECT id FROM "${t.schema}".quotes WHERE status = 'draft' LIMIT 1`,
        );
        const line = (qty: number, unit: number, minutes: number) =>
          t.run(
            `INSERT INTO "${t.schema}".quote_line_items (quote_id, service_id, description, quantity, unit_cents, minutes)
             VALUES ('${q.id}', '${svc.id}', 'Sleeve', ${qty}, ${unit}, ${minutes})`,
          );
        await line(2, 5000, 90);
        await violates(line(0, 5000, 90), /quote_line_items_quantity_check/);
        await violates(line(1, -1, 90), /quote_line_items_unit_check/);
        await violates(line(1, 100, 1441), /quote_line_items_minutes_check/);
        await violates(
          t.run(`DELETE FROM "${t.schema}".services WHERE id = '${svc.id}'`),
          /quote_line_items_service_id_fkey/,
        );
        await t.run(`DELETE FROM "${t.schema}".quotes WHERE id = '${q.id}'`);
        const left = await t.run(
          `SELECT count(*)::int AS n FROM "${t.schema}".quote_line_items WHERE quote_id = '${q.id}'`,
        );
        expect(left[0].n).toBe(0);
      } finally {
        await t.drop();
      }
    },
    120_000,
  );

  itDb(
    "0048 enforces address, service area and travel setting constraints",
    async () => {
      const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
      const t = await scratchTenant("p3o");
      slugs.push(t.slug);
      try {
        const [client] = await t.run(
          `INSERT INTO "${t.schema}".clients (name, email) VALUES ('O Client', 'o@example.com') RETURNING id`,
        );
        const addr = (lat: string, lng: string, src = "'postal_centroid'") =>
          t.run(
            `INSERT INTO "${t.schema}".client_addresses (client_id, line1, postal_code, lat, lng, geo_source)
             VALUES ('${client.id}', '1 Main St', '10001', ${lat}, ${lng}, ${src})`,
          );
        await addr("40.75", "-73.99");
        await addr("NULL", "NULL", "NULL");
        await violates(addr("40.75", "NULL"), /client_addresses_geo_check/);
        await violates(addr("91", "10"), /client_addresses_geo_check/);
        await violates(addr("40.75", "-73.99", "'guess'"), /client_addresses_geo_source_check/);

        const area = (cols: string, vals: string) =>
          t.run(`INSERT INTO "${t.schema}".service_areas (name, ${cols}) VALUES ('Area', ${vals})`);
        await area("kind, postal_codes", "'postal_codes', '{10001,10002}'");
        await area("kind, center_lat, center_lng, radius_km", "'radius', 40.7, -74, 15");
        // A radius area with no center fails its check.
        await violates(area("kind, radius_km", "'radius', 15"), /service_areas_radius_check/);
        await violates(
          area("kind, center_lat, center_lng, radius_km", "'radius', 40.7, -74, 501"),
          /service_areas_radius_check/,
        );
        await violates(area("kind", "'postal_codes'"), /service_areas_postal_check/);
        await violates(area("kind", "'blob'"), /service_areas_kind_check/);

        const [staff] = await t.run(
          `INSERT INTO "${t.schema}".staff (display_name) VALUES ('Tech') RETURNING id`,
        );
        const travel = (extra: string) =>
          t.run(
            `INSERT INTO "${t.schema}".staff_travel_settings (staff_id, base_lat, base_lng${extra ? ", " + extra.split("=")[0] : ""})
             VALUES ('${staff.id}', 40.7, -74${extra ? ", " + extra.split("=")[1] : ""})`,
          );
        await violates(travel("speed_kmh=2"), /staff_travel_speed_check/);
        await violates(travel("max_travel_min=1"), /staff_travel_max_check/);
        await violates(travel("travel_buffer_min=121"), /staff_travel_buffer_check/);
        await travel("");

        const existing = await t.run(`SELECT 1 FROM "${t.schema}".business_settings LIMIT 1`);
        if (existing.length === 0) {
          await t.run(`INSERT INTO "${t.schema}".business_settings DEFAULT VALUES`);
        }
        const [bs] = await t.run(`SELECT arrival_window_min FROM "${t.schema}".business_settings LIMIT 1`);
        expect(bs.arrival_window_min).toBe(120);
        await violates(
          t.run(`UPDATE "${t.schema}".business_settings SET arrival_window_min = 45`),
          /business_settings_arrival_window_check/,
        );
      } finally {
        await t.drop();
      }
    },
    120_000,
  );

  itDb(
    "0049 up is a no-op the second time and enforces project, window and consent constraints",
    async () => {
      const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
      const { migrations } = await import("./index");
      const { schemaFingerprint } = await import("../schema-fingerprint");
      const t = await scratchTenant("p3c");
      slugs.push(t.slug);
      try {
        // Running the whole of 0049 again changes nothing and does not error.
        const before = await schemaFingerprint(t.schema);
        const m49 = migrations.find((m) => m.version === 49)!;
        for (const stmt of m49.up(t.schema)) {
          const { publicDb } = await import("@/lib/db");
          await publicDb.execute(stmt);
        }
        expect(await schemaFingerprint(t.schema)).toEqual(before);

        const [client] = await t.run(
          `INSERT INTO "${t.schema}".clients (name, email) VALUES ('C Client', 'c@example.com') RETURNING id`,
        );
        const project = (extra = "", vals = "") =>
          t.run(
            `INSERT INTO "${t.schema}".projects (client_id, title, access_token${extra})
             VALUES ('${client.id}', 'Sleeve', '${crypto.randomUUID()}'${vals})`,
          );
        await project();
        await violates(project(", status", ", 'bogus'"), /projects_status_check/);
        await violates(project(", est_sessions", ", 0"), /projects_sessions_check/);
        await violates(project(", quoted_total_cents", ", -1"), /projects_total_check/);
        await violates(project(", design_approved_at", ", now()"), /projects_approval_check/);

        // Booking windows must close after they open; books_mode is bounded.
        await violates(
          t.run(
            `INSERT INTO "${t.schema}".booking_windows (opens_at, closes_at)
             VALUES (now(), now() - interval '1 day')`,
          ),
          /booking_windows_range_check/,
        );
        const [staff] = await t.run(
          `INSERT INTO "${t.schema}".staff (display_name) VALUES ('Tech') RETURNING id, books_mode`,
        );
        expect(staff.books_mode).toBe("open");
        await violates(
          t.run(`UPDATE "${t.schema}".staff SET books_mode = 'nope' WHERE id = '${staff.id}'`),
          /staff_books_mode_check/,
        );

        // Form templates default to intake; the age gate is bounded.
        const [tpl] = await t.run(
          `INSERT INTO "${t.schema}".form_templates (name) VALUES ('Consent') RETURNING id, kind, min_age, requires_id`,
        );
        expect(tpl).toMatchObject({ kind: "intake", min_age: null, requires_id: 0 });
        await violates(
          t.run(`UPDATE "${t.schema}".form_templates SET min_age = 12 WHERE id = '${tpl.id}'`),
          /form_templates_min_age_check/,
        );
        await violates(
          t.run(`UPDATE "${t.schema}".form_templates SET kind = 'nope' WHERE id = '${tpl.id}'`),
          /form_templates_kind_check/,
        );

        // An ID check needs both who and when.
        const [appt] = await t.run(
          `INSERT INTO "${t.schema}".appointments (staff_id, client_id, during)
           VALUES ('${staff.id}', '${client.id}', tstzrange('2030-01-07T15:00Z','2030-01-07T16:00Z','[)'))
           RETURNING id`,
        );
        const [resp] = await t.run(
          `INSERT INTO "${t.schema}".form_responses (form_template_id, appointment_id, client_id)
           VALUES ('${tpl.id}', '${appt.id}', '${client.id}') RETURNING id`,
        );
        await violates(
          t.run(`UPDATE "${t.schema}".form_responses SET verified_by = 'staff-1' WHERE id = '${resp.id}'`),
          /form_responses_verified_check/,
        );
        await t.run(
          `UPDATE "${t.schema}".form_responses SET verified_by = 'staff-1', verified_at = now() WHERE id = '${resp.id}'`,
        );

        const existing = await t.run(`SELECT 1 FROM "${t.schema}".business_settings LIMIT 1`);
        if (existing.length === 0) {
          await t.run(`INSERT INTO "${t.schema}".business_settings DEFAULT VALUES`);
        }
        const [bs] = await t.run(`SELECT id_retention_days FROM "${t.schema}".business_settings LIMIT 1`);
        expect(bs.id_retention_days).toBe(365);
        await violates(
          t.run(`UPDATE "${t.schema}".business_settings SET id_retention_days = 45`),
          /business_settings_id_retention_check/,
        );
        await violates(
          t.run(
            `INSERT INTO "${t.schema}".charges (appointment_id, client_id, amount_cents, reason, deposit_applied_cents)
             VALUES ('${appt.id}', '${client.id}', 100, 'service_payment', -1)`,
          ),
          /charges_deposit_applied_check/,
        );
      } finally {
        await t.drop();
      }
    },
    120_000,
  );
  itDb(
    "0050 up is a no-op the second time and the guard trigger is installed",
    async () => {
      const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
      const { migrations } = await import("./index");
      const { schemaFingerprint } = await import("../schema-fingerprint");
      const t = await scratchTenant("p3k");
      slugs.push(t.slug);
      try {
        const before = await schemaFingerprint(t.schema);
        const m50 = migrations.find((m) => m.version === 50)!;
        const { publicDb } = await import("@/lib/db");
        for (const stmt of m50.up(t.schema)) await publicDb.execute(stmt);
        expect(await schemaFingerprint(t.schema)).toEqual(before);

        const [svc] = await t.run(
          `SELECT is_class, class_capacity FROM "${t.schema}".services LIMIT 1`,
        );
        if (svc) expect(svc.is_class).toBe(0);
        await violates(
          t.run(
            `INSERT INTO "${t.schema}".services (name, default_duration_minutes, is_class) VALUES ('X', 30, 2)`,
          ),
          /services_is_class_check/,
        );
        await violates(
          t.run(
            `INSERT INTO "${t.schema}".services (name, default_duration_minutes, class_capacity) VALUES ('X', 30, 501)`,
          ),
          /services_class_capacity_check/,
        );
        const trg = await t.run(
          `SELECT 1 FROM pg_trigger WHERE tgname = 'class_enrollments_guard_trg'
             AND tgrelid = '"${t.schema}".class_enrollments'::regclass`,
        );
        expect(trg).toHaveLength(1);
      } finally {
        await t.drop();
      }
    },
    120_000,
  );
  itDb(
    "0051 up is a no-op the second time; down deletes pack-sale charges and restores NOT NULL",
    async () => {
      const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
      const { migrations } = await import("./index");
      const { schemaFingerprint } = await import("../schema-fingerprint");
      const { rollbackTenant } = await import("./runner");
      const { LATEST_SCHEMA_VERSION } = await import("./index");
      const t = await scratchTenant("p3l");
      slugs.push(t.slug);
      try {
        const before = await schemaFingerprint(t.schema);
        const m51 = migrations.find((m) => m.version === 51)!;
        const { publicDb } = await import("@/lib/db");
        for (const stmt of m51.up(t.schema)) await publicDb.execute(stmt);
        expect(await schemaFingerprint(t.schema)).toEqual(before);

        const S = t.schema;
        const [client] = await t.run(
          `INSERT INTO "${S}".clients (name, email) VALUES ('Pat', 'pat-${Date.now()}@example.com') RETURNING id`,
        );
        const [pkg] = await t.run(
          `INSERT INTO "${S}".client_packages (client_id, name) VALUES ('${client.id}', '5 pack') RETURNING id`,
        );
        await t.run(
          `INSERT INTO "${S}".charges (client_id, client_package_id, amount_cents, reason, status)
           VALUES ('${client.id}', '${pkg.id}', 20000, 'package_sale', 'completed')`,
        );
        expect(await t.run(`SELECT 1 FROM "${S}".charges WHERE appointment_id IS NULL`)).toHaveLength(1);

        const down = await rollbackTenant(t.slug, LATEST_SCHEMA_VERSION, 50);
        expect(down.error).toBeUndefined();
        expect(await t.run(`SELECT 1 FROM "${S}".charges`)).toHaveLength(0);
        const [col] = await t.run(
          `SELECT is_nullable FROM information_schema.columns
            WHERE table_schema = '${S}' AND table_name = 'charges' AND column_name = 'appointment_id'`,
        );
        expect(col.is_nullable).toBe("NO");
      } finally {
        await t.drop();
      }
    },
    120_000,
  );
});
