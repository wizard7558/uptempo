// @vitest-environment node
import { afterAll, describe, expect, it, vi } from "vitest";

const itDb = process.env.DATABASE_URL ? it : it.skip;
const state = vi.hoisted(() => ({ slug: "" }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/rbac", () => ({
  requireStaff: async () => ({ userId: "u1", role: "owner", tenantSlug: state.slug }),
  AuthError: class AuthError extends Error {
    code: string;
    constructor(code: string, message?: string) {
      super(message ?? code);
      this.name = "AuthError";
      this.code = code;
    }
  },
}));
vi.mock("@/lib/terms/server", () => ({
  getT: async () => (key: string) => key,
}));

const slugs: string[] = [];

afterAll(async () => {
  if (!process.env.DATABASE_URL) return;
  const { dropTenantSchema } = await import("@/lib/tenant/provision");
  for (const slug of slugs) {
    try {
      await dropTenantSchema(slug);
    } catch {
      // Ignore cleanup errors
    }
  }
});

describe("custom field definitions", () => {
  itDb("seeds nail shape once, merges a value, then filters on it", async () => {
    const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
    const t = await scratchTenant("cfields");
    slugs.push(t.slug);
    state.slug = t.slug;
    try {
      await t.run(`UPDATE tenants SET industry = 'nail_salon' WHERE slug = '${t.slug}'`);
      const { ensureCustomFieldDefinitions, attributeFilterSql } = await import("./service");
      const { setEntityAttributes } = await import("@/actions/custom-fields");
      const { withTenantDb } = await import("@/lib/db/tenant");

      await ensureCustomFieldDefinitions(t.slug);
      await ensureCustomFieldDefinitions(t.slug);
      const defs = await t.run(
        `SELECT key, type, options FROM "${t.schema}".custom_field_definitions ORDER BY key`,
      );
      expect(defs).toEqual([
        {
          key: "nail_shape",
          type: "select",
          options: [
            { value: "Square", label: "Square" },
            { value: "Round", label: "Round" },
            { value: "Oval", label: "Oval" },
            { value: "Almond", label: "Almond" },
            { value: "Coffin", label: "Coffin" },
            { value: "Stiletto", label: "Stiletto" },
          ],
        },
      ]);

      const [kept] = await t.run(`INSERT INTO "${t.schema}".clients (name) VALUES ('Kept') RETURNING id`);
      const [other] = await t.run(`INSERT INTO "${t.schema}".clients (name) VALUES ('Other') RETURNING id`);
      const saved = await setEntityAttributes({
        entity: "client",
        ownerId: String(kept.id),
        values: { nail_shape: "Oval" },
      });
      expect(saved).toEqual({ ok: true });
      const cleared = await setEntityAttributes({
        entity: "client",
        ownerId: String(other.id),
        values: { nail_shape: null },
      });
      expect(cleared).toEqual({ ok: true });

      const [keptRow] = await t.run(
        `SELECT attributes FROM "${t.schema}".clients WHERE id = '${kept.id}'`,
      );
      expect(keptRow.attributes).toEqual({ nail_shape: "Oval" });
      const [otherRow] = await t.run(
        `SELECT attributes FROM "${t.schema}".clients WHERE id = '${other.id}'`,
      );
      expect(otherRow.attributes).toEqual({});

      const matches = await withTenantDb(t.slug, async (db, tables) =>
        db
          .select({ name: tables.clients.name })
          .from(tables.clients)
          .where(attributeFilterSql(tables.clients.attributes, { key: "nail_shape", type: "select" }, "Oval")),
      );
      expect(matches.map((row) => row.name).sort()).toEqual(["Kept"]);
    } finally {
      await t.drop();
    }
  });

  itDb("listClients returns only the client whose hair profile includes blonde", async () => {
    const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
    const t = await scratchTenant("cfilter");
    slugs.push(t.slug);
    state.slug = t.slug;
    try {
      await t.run(
        `INSERT INTO "${t.schema}".custom_field_definitions
          (entity, key, label, type, options, sort, is_default, show_on_card, client_editable, match_product_tags)
         VALUES (
           'client', 'hair_types', 'Hair profile', 'multi',
           '[{"value":"blonde","label":"Blonde"},{"value":"curly","label":"Curly"}]'::jsonb,
           10, 1, 1, 1, 1
         )`,
      );
      await t.run(
        `INSERT INTO "${t.schema}".clients (name, attributes) VALUES
          ('K1', '{"hair_types":["blonde","color-treated"]}'::jsonb),
          ('K2', '{"hair_types":["curly"]}'::jsonb)`,
      );
      const { listClients } = await import("@/actions/clients");
      const result = await listClients({ attributeFilter: { key: "hair_types", value: "blonde" } });
      expect(result.clients.map((client) => client.name)).toEqual(["K1"]);
    } finally {
      await t.drop();
    }
  });
});
