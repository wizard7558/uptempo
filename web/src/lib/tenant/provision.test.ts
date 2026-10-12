// @vitest-environment node
import { randomBytes } from "node:crypto";
import { describe, it, expect, afterAll, beforeAll } from "vitest";

// Skip these integration tests if DATABASE_URL is not set
const DATABASE_URL = process.env.DATABASE_URL;
const itDb = DATABASE_URL ? it : it.skip;

// Lazy imports to avoid connection errors when DATABASE_URL is missing
let provisionTenantSchema: typeof import("./provision").provisionTenantSchema;
let dropTenantSchema: typeof import("./provision").dropTenantSchema;
let withTenantDb: typeof import("@/lib/db/tenant").withTenantDb;
let sql: typeof import("drizzle-orm").sql;
let publicDb: typeof import("@/lib/db").publicDb;

const testSlugs: string[] = [];

beforeAll(async () => {
  if (!DATABASE_URL) return;

  const provisionModule = await import("./provision");
  provisionTenantSchema = provisionModule.provisionTenantSchema;
  dropTenantSchema = provisionModule.dropTenantSchema;

  const tenantModule = await import("@/lib/db/tenant");
  withTenantDb = tenantModule.withTenantDb;

  const drizzleOrm = await import("drizzle-orm");
  sql = drizzleOrm.sql;

  const dbModule = await import("@/lib/db");
  publicDb = dbModule.publicDb;
});

afterAll(async () => {
  if (!DATABASE_URL) return;

  // Clean up all test schemas
  for (const slug of testSlugs) {
    try {
      await dropTenantSchema(slug);
    } catch {
      // Ignore cleanup errors
    }
  }
});

let slugCounter = 0;

/**
 * A slug no other call can repeat. The old `Date.now()` + `random() * 1000` form gave two
 * back-to-back calls in one millisecond a 1-in-1000 chance of the same schema, and a repeat
 * makes the second `provisionTenantSchema` fail with `relation "services" already exists`.
 * The counter makes repeats inside this file impossible; the random tail separates parallel
 * test files and runs.
 */
function makeTestSlug(): string {
  slugCounter += 1;
  const slug = `test${randomBytes(4).toString("hex")}n${slugCounter}`;
  testSlugs.push(slug);
  return slug;
}

// Provisioning a tenant runs every migration and takes ~12 s against the remote database, even
// with nothing else running. The two data-isolation tests used to provision their own pair
// one after the other (~24 s of a 30 s budget each), so any load tipped them over. They share
// one pair, provisioned concurrently (which is itself the scenario they test), instead.
let pair: { slugA: string; slugB: string };

describe("tenant provisioning (integration)", () => {
  beforeAll(async () => {
    if (!DATABASE_URL) return;
    pair = { slugA: makeTestSlug(), slugB: makeTestSlug() };
    await Promise.all([
      provisionTenantSchema({ name: "Salon A", slug: pair.slugA }),
      provisionTenantSchema({ name: "Salon B", slug: pair.slugB }),
    ]);
  }, 180_000);

  itDb(
    "creates a schema with the correct name",
    async () => {
      const slug = makeTestSlug();
      const result = await provisionTenantSchema({
        name: "Test Salon",
        slug,
      });

      expect(result.schemaName).toBe(`tenant_${slug}`);
      expect(result.tenantId).toBeDefined();

      // Verify schema exists in pg_namespace
      const schemas = await publicDb.execute(
        sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = ${`tenant_${slug}`}`,
      );
      // drizzle execute returns a RowList array directly
      const rows = Array.from(schemas as Iterable<Record<string, unknown>>);
      expect(rows.length).toBe(1);
    },
    30000,
  );

  itDb(
    "creates all expected tables in the provisioned schema",
    async () => {
      const slug = makeTestSlug();
      await provisionTenantSchema({ name: "Table Test Salon", slug });

      const expectedTables = [
        "aftercare_templates",
        "alerts",
        "appointment_checklist_items",
        "appointment_resources",
        "appointment_services",
        "appointments",
        "assistant_tasks",
        "attachments",
        "availability_overrides",
        "booking_groups",
        "booking_requests",
        "booking_verifications",
        "booking_windows",
        "branding_settings",
        "business_settings",
        "calendar_connections",
        "charges",
        "checklist_templates",
        "class_enrollments",
        "class_sessions",
        "client_addresses",
        "client_memberships",
        "client_packages",
        "client_service_overrides",
        "clients",
        "credit_ledger",
        "custom_field_definitions",
        "device_tokens",
        "expenses",
        "expense_categories",
        "external_events",
        "form_responses",
        "form_templates",
        "gift_card_transactions",
        "gift_cards",
        "locations",
        "membership_plans",
        "orders",
        "packages",
        "policy_signatures",
        "products",
        "projects",
        "queue_entries",
        "quote_line_items",
        "quotes",
        "recurrence_rules",
        "resources",
        "service_addons",
        "service_aftercare_assignments",
        "service_areas",
        "service_categories",
        "service_resource_requirements",
        "service_form_assignments",
        "services",
        "sms_consent",
        "sms_messages",
        "slot_waitlist",
        "staff",
        "staff_services",
        "staff_travel_settings",
        "stored_value_balances",
        "stored_value_transactions",
        "task_catalog",
        "time_blocks",
        "waitlist_openings",
        "working_hours",
      ];

      const result = await publicDb.execute(
        sql`SELECT table_name FROM information_schema.tables WHERE table_schema = ${`tenant_${slug}`} ORDER BY table_name`,
      );

      // drizzle execute returns a RowList array directly
      const rows = Array.from(result as Iterable<Record<string, unknown>>);
      const tableNames = rows.map((r) => r.table_name);
      for (const expected of expectedTables) {
        expect(tableNames, `Missing table: ${expected}`).toContain(expected);
      }
      expect(tableNames.length).toBe(expectedTables.length);

      const brandCols = await publicDb.execute(sql`
        SELECT column_name, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = ${`tenant_${slug}`}
          AND table_name = 'branding_settings'
          AND column_name IN ('brand_color', 'font_pairing', 'corner_style', 'density', 'color_mode')
      `);
      const brandRows = Array.from(brandCols as Iterable<Record<string, unknown>>);
      const brandByName = Object.fromEntries(
        brandRows.map((row) => [String(row.column_name), row]),
      );
      expect(brandRows).toHaveLength(5);
      expect(brandByName.brand_color).toMatchObject({ is_nullable: "NO" });
      expect(String(brandByName.brand_color.column_default)).toContain("#B3122E");
      expect(String(brandByName.font_pairing.column_default)).toContain("score");
      expect(String(brandByName.corner_style.column_default)).toContain("soft");
      expect(String(brandByName.density.column_default)).toContain("comfortable");
      expect(String(brandByName.color_mode.column_default)).toContain("light");
    },
    30000,
  );

  itDb(
    "isolates data between tenant schemas",
    async () => {
      const { slugA, slugB } = pair;

      // Insert a service into tenant A
      await withTenantDb(slugA, async (db, tables) => {
        await db.insert(tables.services).values({
          name: "Haircut A",
          defaultDurationMinutes: 30,
        });
      });

      // Insert a different service into tenant B
      await withTenantDb(slugB, async (db, tables) => {
        await db.insert(tables.services).values({
          name: "Haircut B",
          defaultDurationMinutes: 45,
        });
      });

      // Verify tenant A only sees its own data
      const servicesA = await withTenantDb(slugA, async (db, tables) => {
        return db.select().from(tables.services);
      });
      expect(servicesA).toHaveLength(1);
      expect(servicesA[0].name).toBe("Haircut A");
      expect(servicesA[0].defaultDurationMinutes).toBe(30);

      // Verify tenant B only sees its own data
      const servicesB = await withTenantDb(slugB, async (db, tables) => {
        return db.select().from(tables.services);
      });
      expect(servicesB).toHaveLength(1);
      expect(servicesB[0].name).toBe("Haircut B");
      expect(servicesB[0].defaultDurationMinutes).toBe(45);
    },
    30000,
  );

  itDb(
    "concurrent requests to different tenants do not leak data",
    async () => {
      // Same pair as above. This test only touches `clients`; the isolation test only `services`.
      const { slugA: slugC, slugB: slugD } = pair;

      // Run concurrent inserts
      await Promise.all([
        withTenantDb(slugC, async (db, tables) => {
          await db.insert(tables.clients).values({
            name: "Client C",
            email: "c@test.com",
          });
        }),
        withTenantDb(slugD, async (db, tables) => {
          await db.insert(tables.clients).values({
            name: "Client D",
            email: "d@test.com",
          });
        }),
      ]);

      // Verify isolation after concurrent writes
      const [clientsC, clientsD] = await Promise.all([
        withTenantDb(slugC, async (db, tables) => {
          return db.select().from(tables.clients);
        }),
        withTenantDb(slugD, async (db, tables) => {
          return db.select().from(tables.clients);
        }),
      ]);

      expect(clientsC).toHaveLength(1);
      expect(clientsC[0].name).toBe("Client C");
      expect(clientsD).toHaveLength(1);
      expect(clientsD[0].name).toBe("Client D");
    },
    30000,
  );
});
