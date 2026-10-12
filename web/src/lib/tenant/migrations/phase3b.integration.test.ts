// @vitest-environment node
import { describe, it, expect, afterAll } from "vitest";

const itDb = process.env.DATABASE_URL ? it : it.skip;

/** Last schema version before the Phase 3.5-3.8 migrations (0052 onward). */
const P3B_BASE = 51;

const slugs: string[] = [];
const makeSlug = (tag: string) => {
  const slug = `p3b${tag}${Date.now()}${Math.floor(Math.random() * 1000)}`;
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

describe("Phase 3.5-3.8 migrations (integration)", () => {
  itDb(
    "fresh@LATEST equals fresh@base + migrate; down returns to base; a second up is a no-op",
    async () => {
      const { provisionTenantSchema } = await import("../provision");
      const { migrateTenant, rollbackTenant } = await import("./runner");
      const { LATEST_SCHEMA_VERSION } = await import("./index");
      const { schemaFingerprint } = await import("../schema-fingerprint");

      const a = makeSlug("a");
      const b = makeSlug("b");
      await provisionTenantSchema({ name: "P3B A", slug: a });
      await provisionTenantSchema({ name: "P3B B", slug: b, throughVersion: P3B_BASE });
      const fpA = await schemaFingerprint(`tenant_${a}`);
      const fpBase = await schemaFingerprint(`tenant_${b}`);
      expect(fpBase).not.toEqual(fpA);

      const up = await migrateTenant(b, P3B_BASE);
      expect(up.error).toBeUndefined();
      expect(up.toVersion).toBe(LATEST_SCHEMA_VERSION);
      expect(await schemaFingerprint(`tenant_${b}`)).toEqual(fpA);

      const down = await rollbackTenant(b, LATEST_SCHEMA_VERSION, P3B_BASE);
      expect(down.error).toBeUndefined();
      expect(await schemaFingerprint(`tenant_${b}`)).toEqual(fpBase);

      const again = await migrateTenant(b, P3B_BASE);
      expect(again.error).toBeUndefined();
      expect(again.toVersion).toBe(LATEST_SCHEMA_VERSION);
      expect(await schemaFingerprint(`tenant_${b}`)).toEqual(fpA);

      // Already at LATEST: nothing to apply, fingerprint unchanged.
      const noop = await migrateTenant(b, LATEST_SCHEMA_VERSION);
      expect(noop.error).toBeUndefined();
      expect(await schemaFingerprint(`tenant_${b}`)).toEqual(fpA);
    },
    120_000,
  );

  itDb(
    "0052 allows one active queue place per phone",
    async () => {
      const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
      const { pgErrorInfo } = await import("@/lib/db/pg-error");
      const t = await scratchTenant("p3bq");
      slugs.push(t.slug);
      try {
        const insert = (name: string) =>
          t.run(
            `INSERT INTO "${t.schema}".queue_entries (name, phone, public_token_hash)
             VALUES ('${name}', '+15555550100', '${crypto.randomUUID()}') RETURNING id`,
          );
        const [first] = await insert("First");
        let caught: unknown;
        try {
          await insert("Second");
        } catch (e) {
          caught = e;
        }
        expect(pgErrorInfo(caught)).toMatchObject({
          code: "23505",
          constraint: "queue_entries_phone_active_unique",
        });

        await t.run(
          `UPDATE "${t.schema}".queue_entries SET status = 'done' WHERE id = '${first.id}'`,
        );
        const [second] = await insert("Second");
        expect(second.id).toBeTruthy();

        // Defaults on the settings columns.
        await t.run(`INSERT INTO "${t.schema}".business_settings (timezone) VALUES ('UTC') ON CONFLICT DO NOTHING`);
        const [s] = await t.run(
          `SELECT queue_open, queue_max_waiting, queue_text_on_join, queue_kiosk_token_hash FROM "${t.schema}".business_settings LIMIT 1`,
        );
        expect(s).toMatchObject({
          queue_open: 0,
          queue_max_waiting: 30,
          queue_text_on_join: 0,
          queue_kiosk_token_hash: null,
        });
      } finally {
        await t.drop();
      }
    },
    60_000,
  );

  itDb(
    "0053 rejects an offered waitlist row with no hold and caps opening attempts",
    async () => {
      const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
      const { pgErrorInfo } = await import("@/lib/db/pg-error");
      const t = await scratchTenant("p3bw");
      slugs.push(t.slug);
      try {
        const [client] = await t.run(
          `INSERT INTO "${t.schema}".clients (name) VALUES ('W') RETURNING id`,
        );
        const [staff] = await t.run(
          `INSERT INTO "${t.schema}".staff (display_name) VALUES ('S') RETURNING id`,
        );
        let offered: unknown;
        try {
          await t.run(
            `INSERT INTO "${t.schema}".slot_waitlist (client_id, service_ids, date_from, date_to, status)
             VALUES ('${client.id}', '["svc"]'::jsonb, '2026-06-17', '2026-06-17', 'offered')`,
          );
        } catch (e) {
          offered = e;
        }
        expect(pgErrorInfo(offered)).toMatchObject({
          code: "23514",
          constraint: "slot_waitlist_offer_check",
        });

        const [opening] = await t.run(
          `INSERT INTO "${t.schema}".waitlist_openings (staff_id, starts_at, ends_at)
           VALUES ('${staff.id}', '2026-06-17T18:00:00Z', '2026-06-17T18:30:00Z') RETURNING id`,
        );
        let attempts: unknown;
        try {
          await t.run(
            `UPDATE "${t.schema}".waitlist_openings SET attempts = 4 WHERE id = '${opening.id}'`,
          );
        } catch (e) {
          attempts = e;
        }
        expect(pgErrorInfo(attempts)).toMatchObject({
          code: "23514",
          constraint: "waitlist_openings_attempts_check",
        });

        await t.run(
          `INSERT INTO "${t.schema}".business_settings (timezone) VALUES ('America/New_York')`,
        );
        const [settings] = await t.run(
          `SELECT waitlist_hold_minutes FROM "${t.schema}".business_settings LIMIT 1`,
        );
        expect(settings.waitlist_hold_minutes).toBe(15);
      } finally {
        await t.drop();
      }
    },
    60_000,
  );

  itDb(
    "0054 stores a gift card hash and rejects a zero redemption or a short code hash",
    async () => {
      const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
      const { pgErrorInfo } = await import("@/lib/db/pg-error");
      const t = await scratchTenant("p3bg");
      slugs.push(t.slug);
      const hash = "a".repeat(64);
      try {
        const [card] = await t.run(
          `INSERT INTO "${t.schema}".gift_cards (code_hash, last4, initial_cents, balance_cents, source)
           VALUES ('${hash}', 'ABCD', 5000, 5000, 'comp') RETURNING id`,
        );
        expect(card.id).toBeTruthy();

        let shortHash: unknown;
        try {
          await t.run(
            `INSERT INTO "${t.schema}".gift_cards (code_hash, last4, initial_cents, balance_cents, source)
             VALUES ('abc', 'ABCD', 5000, 5000, 'comp')`,
          );
        } catch (e) {
          shortHash = e;
        }
        expect(pgErrorInfo(shortHash)).toMatchObject({
          code: "23514",
          constraint: "gift_cards_code_hash_check",
        });

        let tiny: unknown;
        try {
          await t.run(
            `INSERT INTO "${t.schema}".gift_cards (code_hash, last4, initial_cents, balance_cents, source)
             VALUES ('${"b".repeat(64)}', 'WXYZ', 50, 50, 'comp')`,
          );
        } catch (e) {
          tiny = e;
        }
        expect(pgErrorInfo(tiny)).toMatchObject({
          code: "23514",
          constraint: "gift_cards_initial_check",
        });

        const [client] = await t.run(
          `INSERT INTO "${t.schema}".clients (name) VALUES ('G') RETURNING id`,
        );
        let zeroGift: unknown;
        try {
          await t.run(
            `INSERT INTO "${t.schema}".charges (client_id, amount_cents, reason, gift_card_cents)
             VALUES ('${client.id}', 1000, 'service_payment', 0)`,
          );
        } catch (e) {
          zeroGift = e;
        }
        expect(pgErrorInfo(zeroGift)).toMatchObject({
          code: "23514",
          constraint: "charges_gift_card_cents_check",
        });
      } finally {
        await t.drop();
      }
    },
    60_000,
  );

  itDb(
    "0055 stores a photo caption and a service checklist, and rejects an over-long caption or a half-checked item",
    async () => {
      const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
      const { pgErrorInfo } = await import("@/lib/db/pg-error");
      const t = await scratchTenant("p3bp");
      slugs.push(t.slug);
      try {
        const [photo] = await t.run(
          `INSERT INTO "${t.schema}".attachments (
             owner_type, kind, storage_key, mime, size_bytes, is_private, uploaded_by, caption
           ) VALUES (
             'appointment', 'before', 't/${t.slug}/appointments/p.jpg', 'image/jpeg', 1200, 1, 'user-1', 'Left side'
           ) RETURNING id, caption`,
        );
        expect(photo).toMatchObject({ caption: "Left side" });

        let longCaption: unknown;
        try {
          await t.run(
            `INSERT INTO "${t.schema}".attachments (
               owner_type, kind, storage_key, mime, size_bytes, is_private, uploaded_by, caption
             ) VALUES (
               'appointment', 'after', 't/${t.slug}/appointments/q.jpg', 'image/jpeg', 1200, 1, 'user-1', '${"x".repeat(201)}'
             )`,
          );
        } catch (e) {
          longCaption = e;
        }
        expect(pgErrorInfo(longCaption)).toMatchObject({
          code: "23514",
          constraint: "attachments_caption_check",
        });

        const [service] = await t.run(
          `INSERT INTO "${t.schema}".services (name, default_duration_minutes) VALUES ('Cut', 30) RETURNING id`,
        );
        const items = JSON.stringify([
          { id: "s1", label: "Clean station" },
          { id: "s2", label: "Stencil approved" },
          { id: "s3", label: "Aftercare explained" },
        ]);
        const [template] = await t.run(
          `INSERT INTO "${t.schema}".checklist_templates (service_id, items)
           VALUES ('${service.id}', '${items}'::jsonb) RETURNING id`,
        );
        expect(template.id).toBeTruthy();

        const tooMany = JSON.stringify(
          Array.from({ length: 31 }, (_, i) => ({ id: `n${i}`, label: `Step ${i + 1}` })),
        );
        let longList: unknown;
        try {
          await t.run(
            `UPDATE "${t.schema}".checklist_templates SET items = '${tooMany}'::jsonb WHERE id = '${template.id}'`,
          );
        } catch (e) {
          longList = e;
        }
        expect(pgErrorInfo(longList)).toMatchObject({
          code: "23514",
          constraint: "checklist_templates_items_check",
        });

        const [staff] = await t.run(
          `INSERT INTO "${t.schema}".staff (display_name) VALUES ('Ari') RETURNING id`,
        );
        const [client] = await t.run(
          `INSERT INTO "${t.schema}".clients (name) VALUES ('Pat') RETURNING id`,
        );
        const [appt] = await t.run(
          `INSERT INTO "${t.schema}".appointments (staff_id, client_id, during)
           VALUES ('${staff.id}', '${client.id}', tstzrange(now(), now() + interval '1 hour', '[)'))
           RETURNING id`,
        );
        let halfDone: unknown;
        try {
          await t.run(
            `INSERT INTO "${t.schema}".appointment_checklist_items (appointment_id, label, done_at)
             VALUES ('${appt.id}', 'Clean station', now())`,
          );
        } catch (e) {
          halfDone = e;
        }
        expect(pgErrorInfo(halfDone)).toMatchObject({
          code: "23514",
          constraint: "appointment_checklist_items_done_check",
        });

        await t.run(
          `INSERT INTO "${t.schema}".appointment_checklist_items (appointment_id, label, source_key)
           VALUES ('${appt.id}', 'Clean station', 'src-1')`,
        );
        let duplicate: unknown;
        try {
          await t.run(
            `INSERT INTO "${t.schema}".appointment_checklist_items (appointment_id, label, source_key)
             VALUES ('${appt.id}', 'Clean station again', 'src-1')`,
          );
        } catch (e) {
          duplicate = e;
        }
        expect(pgErrorInfo(duplicate)).toMatchObject({
          code: "23505",
          constraint: "appointment_checklist_items_source_unique",
        });
      } finally {
        await t.drop();
      }
    },
    60_000,
  );

  itDb(
    "0056 copies hair types into client attributes and product tags",
    async () => {
      const { provisionTenantSchema } = await import("../provision");
      const { migrateTenant, rollbackTenant } = await import("./runner");
      const { schemaFingerprint } = await import("../schema-fingerprint");
      const { publicDb } = await import("@/lib/db");
      const { sql } = await import("drizzle-orm");

      const run = async (query: string) =>
        Array.from(
          (await publicDb.execute(sql.raw(query))) as Iterable<Record<string, unknown>>,
        );

      const version = P3B_BASE + 4;
      const slug = makeSlug("c");
      const empty = makeSlug("e");
      await provisionTenantSchema({ name: "P3B Hair", slug, throughVersion: version });
      await provisionTenantSchema({ name: "P3B Empty", slug: empty, throughVersion: version });
      const schema = `tenant_${slug}`;
      const emptySchema = `tenant_${empty}`;

      await run(
        `INSERT INTO "${schema}".clients (name, hair_types) VALUES ('K1', '["blonde","color-treated"]'::jsonb)`,
      );
      await run(
        `INSERT INTO "${schema}".clients (name, hair_types) VALUES ('K2', '[]'::jsonb)`,
      );
      await run(
        `INSERT INTO "${schema}".products (name, price_cents, hair_types) VALUES ('P1', 1800, '["all","curly"]'::jsonb)`,
      );
      await run(
        `INSERT INTO "${emptySchema}".clients (name, hair_types) VALUES ('Empty', '[]'::jsonb)`,
      );
      await run(
        `INSERT INTO "${emptySchema}".products (name, price_cents, hair_types) VALUES ('Plain', 500, '[]'::jsonb)`,
      );

      const before = await schemaFingerprint(schema);
      const up = await migrateTenant(slug, version, version + 1);
      expect(up.error).toBeUndefined();
      expect(up.toVersion).toBe(version + 1);

      const clients = await run(
        `SELECT name, attributes, hair_types FROM "${schema}".clients ORDER BY name`,
      );
      expect(clients).toEqual([
        {
          name: "K1",
          attributes: { hair_types: ["blonde", "color-treated"] },
          hair_types: ["blonde", "color-treated"],
        },
        {
          name: "K2",
          attributes: {},
          hair_types: [],
        },
      ]);

      const products = await run(
        `SELECT name, tags, hair_types FROM "${schema}".products`,
      );
      expect(products).toEqual([
        { name: "P1", tags: ["all", "curly"], hair_types: ["all", "curly"] },
      ]);

      const defs = await run(
        `SELECT label, type, options, client_editable, match_product_tags, is_default, show_on_card FROM "${schema}".custom_field_definitions`,
      );
      expect(defs).toEqual([
        {
          label: "Hair profile",
          type: "multi",
          options: [
            { value: "all", label: "All" },
            { value: "blonde", label: "Blonde" },
            { value: "brunette", label: "Brunette" },
            { value: "red", label: "Red" },
            { value: "color-treated", label: "Color Treated" },
            { value: "extensions", label: "Extensions" },
            { value: "curly", label: "Curly" },
            { value: "fine", label: "Fine" },
            { value: "damaged", label: "Damaged" },
          ],
          client_editable: 1,
          match_product_tags: 1,
          is_default: 1,
          show_on_card: 1,
        },
      ]);

      const upEmpty = await migrateTenant(empty, version, version + 1);
      expect(upEmpty.error).toBeUndefined();
      const emptyDefs = await run(
        `SELECT key FROM "${emptySchema}".custom_field_definitions`,
      );
      expect(emptyDefs).toEqual([]);

      const down = await rollbackTenant(slug, version + 1, version);
      expect(down.error).toBeUndefined();
      expect(await schemaFingerprint(schema)).toEqual(before);
      const restored = await run(
        `SELECT hair_types FROM "${schema}".clients WHERE name = 'K1'`,
      );
      expect(restored).toEqual([{ hair_types: ["blonde", "color-treated"] }]);
    },
    120_000,
  );

  itDb(
    "0057 drops hair_types after re-syncing attributes and tags",
    async () => {
      const { provisionTenantSchema } = await import("../provision");
      const { migrateTenant, rollbackTenant } = await import("./runner");
      const { publicDb } = await import("@/lib/db");
      const { sql } = await import("drizzle-orm");
      const { formatAttributeValue } = await import("@/lib/custom-fields/values");
      const { HAIR_OPTIONS_0064 } = await import("./0056-custom-fields");
      const { MARKERS, markerPresent, resolveRepairMarker } = await import(
        "../../../../scripts/repair-tenant-schemas"
      );

      const run = async (query: string) =>
        Array.from(
          (await publicDb.execute(sql.raw(query))) as Iterable<Record<string, unknown>>,
        );

      const version = P3B_BASE + 4;
      const slug = makeSlug("d");
      await provisionTenantSchema({ name: "P3B Drop", slug, throughVersion: version });
      const schema = `tenant_${slug}`;

      await run(
        `INSERT INTO "${schema}".clients (name, hair_types) VALUES ('K1', '["blonde","color-treated"]'::jsonb)`,
      );
      await run(
        `INSERT INTO "${schema}".products (name, price_cents, hair_types) VALUES ('P1', 1800, '["all","curly"]'::jsonb)`,
      );

      const toFields = await migrateTenant(slug, version, version + 1);
      expect(toFields.error).toBeUndefined();
      expect(toFields.toVersion).toBe(version + 1);
      await run(
        `UPDATE "${schema}".products SET tags = '["all","curly","sale"]'::jsonb WHERE name = 'P1'`,
      );

      const dropped = await migrateTenant(slug, version + 1, version + 2);
      expect(dropped.error).toBeUndefined();
      expect(dropped.toVersion).toBe(version + 2);

      const columns = await run(
        `SELECT table_name FROM information_schema.columns WHERE table_schema = '${schema}' AND column_name = 'hair_types' AND table_name IN ('clients', 'products')`,
      );
      expect(columns).toEqual([]);

      const clients = await run(
        `SELECT attributes FROM "${schema}".clients WHERE name = 'K1'`,
      );
      const attributes = clients[0]?.attributes as { hair_types: string[] };
      expect(attributes.hair_types).toEqual(["blonde", "color-treated"]);

      const hair = {
        id: "hair",
        entity: "client" as const,
        key: "hair_types",
        label: "Hair profile",
        type: "multi" as const,
        options: JSON.parse(HAIR_OPTIONS_0064) as { value: string; label: string }[],
        isActive: true,
        showOnCard: true,
        clientEditable: true,
        matchProductTags: true,
        sort: 10,
      };
      expect(formatAttributeValue(hair, attributes.hair_types)).toBe("Blonde, Color Treated");

      const down = await rollbackTenant(slug, version + 2, version + 1);
      expect(down.error).toBeUndefined();
      const restoredClient = await run(
        `SELECT hair_types FROM "${schema}".clients WHERE name = 'K1'`,
      );
      expect(restoredClient).toEqual([{ hair_types: ["blonde", "color-treated"] }]);
      const restoredProduct = await run(
        `SELECT hair_types FROM "${schema}".products WHERE name = 'P1'`,
      );
      expect(restoredProduct).toEqual([{ hair_types: ["all", "curly"] }]);

      const again = await migrateTenant(slug, version + 1, version + 2);
      expect(again.error).toBeUndefined();
      expect(again.toVersion).toBe(version + 2);

      const info = await run(
        `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = '${schema}'`,
      );
      const cols = new Set(info.map((row) => `${row.table_name}.${row.column_name}`));
      const tbls = new Set(info.map((row) => String(row.table_name)));
      const idxRows = await run(
        `SELECT indexname FROM pg_indexes WHERE schemaname = '${schema}'`,
      );
      const idxs = new Set(idxRows.map((row) => String(row.indexname)));
      const renamed = tbls.has("staff") && !tbls.has("stylists");
      for (const markerVersion of [36, 57]) {
        for (const marker of MARKERS[markerVersion]) {
          expect(
            markerPresent(resolveRepairMarker(marker, markerVersion, renamed), cols, idxs, tbls),
          ).toBe(true);
        }
      }
    },
    120_000,
  );
});
