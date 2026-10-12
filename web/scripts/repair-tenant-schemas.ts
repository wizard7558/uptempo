/**
 * Repairs tenant schemas that were provisioned while provision.ts skipped
 * migrations 0033+ (they never ran, and the runner only applies versions above
 * tenants.schema_version).
 *
 * For every tenant (all statuses) and each migration from 33 through LATEST,
 * checks that the migration's tables/columns/indexes exist via information_schema.
 *
 *   npm run repair:tenants              # dry run (default), reports only
 *   npm run repair:tenants -- --apply   # applies fully-missing migrations
 *
 * A migration with only some of its objects present is never applied; it is
 * reported as needing manual review. Applies run in version order inside one
 * transaction per tenant, and tenants.schema_version is left at LATEST.
 * Uses only the DATABASE_URL from .env.local / .env.
 */
import { config } from "dotenv";
import { COLUMN_RENAMES_0040, TABLE_RENAMES_0040 } from "../src/lib/tenant/migrations/0040-domain-renames";

config({ path: ".env.local" });
config({ path: ".env" });

const FIRST_REPAIRED_VERSION = 33;

export type Marker =
  | { kind: "table"; table: string }
  | { kind: "column"; table: string; column: string }
  | { kind: "index"; name: string }
  | { kind: "absent_column"; table: string; column: string };

/** Columns removed by a later migration. Present once the replacement exists. */
const DROPPED_LATER = new Set(["clients.hair_types", "products.hair_types"]);

const tableAlias = new Map<string, string>(TABLE_RENAMES_0040);
const columnAlias = new Map<string, string>(
  COLUMN_RENAMES_0040.map(([table, oldName, newName]) => [`${table}.${oldName}`, newName]),
);

/** Objects each migration creates (tables and columns), by version. */
export const MARKERS: Record<number, Marker[]> = {
  33: [
    { kind: "column", table: "client_memberships", column: "monthly_amount_cents" },
    { kind: "column", table: "client_memberships", column: "stripe_price_id" },
    { kind: "column", table: "membership_plans", column: "allow_custom_amount" },
  ],
  34: [
    { kind: "column", table: "stylists", column: "target_hours_per_week" },
    { kind: "column", table: "stylists", column: "target_hourly_earnings_cents" },
    { kind: "table", table: "alerts" },
  ],
  35: [{ kind: "table", table: "products" }],
  36: [
    { kind: "column", table: "clients", column: "hair_types" },
    { kind: "column", table: "salon_policies", column: "retail_tax_bps" },
    { kind: "column", table: "salon_policies", column: "retail_ship_flat_cents" },
    { kind: "table", table: "orders" },
  ],
  37: [{ kind: "column", table: "services", column: "booking_audience" }],
  38: [
    { kind: "column", table: "salon_policies", column: "monthly_revenue_goal_cents" },
  ],
  39: [{ kind: "index", name: "appointments_double_book_idx" }],
  // Markers for migrations < 40 keep their historical (pre-0040) names; inspect()
  // resolves them through the 0040 rename lists on schemas that are already renamed.
  40: [
    { kind: "table", table: "staff" },
    { kind: "table", table: "staff_services" },
    { kind: "table", table: "business_settings" },
    { kind: "table", table: "stored_value_transactions" },
    { kind: "table", table: "stored_value_balances" },
    { kind: "column", table: "appointments", column: "staff_id" },
    { kind: "column", table: "business_settings", column: "business_address" },
    { kind: "column", table: "charges", column: "stored_value_cents" },
  ],
  41: [{ kind: "table", table: "expense_categories" }],
  42: [
    { kind: "column", table: "business_settings", column: "min_notice_minutes" },
    { kind: "column", table: "business_settings", column: "max_advance_days" },
    { kind: "column", table: "business_settings", column: "slot_interval_minutes" },
    { kind: "column", table: "business_settings", column: "same_day_booking" },
  ],
  43: [
    { kind: "index", name: "working_hours_staff_day_idx" },
    { kind: "table", table: "availability_overrides" },
    { kind: "column", table: "services", column: "buffer_before_min" },
    { kind: "column", table: "services", column: "buffer_after_min" },
    { kind: "column", table: "services", column: "min_notice_min" },
    { kind: "column", table: "services", column: "max_advance_days" },
    { kind: "column", table: "services", column: "slot_interval_min" },
    { kind: "column", table: "services", column: "location_type" },
    { kind: "column", table: "services", column: "variant_of_service_id" },
  ],
  44: [
    { kind: "table", table: "resources" },
    { kind: "table", table: "service_resource_requirements" },
    { kind: "table", table: "appointment_resources" },
  ],
  45: [
    { kind: "table", table: "booking_groups" },
    { kind: "column", table: "appointments", column: "booking_group_id" },
    { kind: "column", table: "charges", column: "booking_group_id" },
  ],
  46: [
    { kind: "table", table: "recurrence_rules" },
    { kind: "column", table: "appointments", column: "recurrence_rule_id" },
    { kind: "column", table: "appointments", column: "recurrence_index" },
    { kind: "index", name: "appointments_recurrence_unique" },
  ],
  47: [
    { kind: "table", table: "booking_requests" },
    { kind: "table", table: "attachments" },
    { kind: "table", table: "quotes" },
    { kind: "table", table: "quote_line_items" },
  ],
  48: [
    { kind: "table", table: "client_addresses" },
    { kind: "table", table: "service_areas" },
    { kind: "table", table: "staff_travel_settings" },
    { kind: "column", table: "appointments", column: "service_address_id" },
    { kind: "column", table: "appointments", column: "arrival_window_min" },
    { kind: "column", table: "appointments", column: "on_my_way_sent_at" },
    { kind: "column", table: "booking_requests", column: "address_id" },
    { kind: "column", table: "business_settings", column: "arrival_window_min" },
  ],
  49: [
    { kind: "table", table: "projects" },
    { kind: "table", table: "booking_windows" },
    { kind: "column", table: "appointments", column: "project_id" },
    { kind: "column", table: "charges", column: "deposit_applied_cents" },
    { kind: "column", table: "quotes", column: "project_sessions" },
    { kind: "column", table: "staff", column: "books_mode" },
    { kind: "column", table: "form_templates", column: "kind" },
    { kind: "column", table: "form_templates", column: "min_age" },
    { kind: "column", table: "form_templates", column: "requires_id" },
    { kind: "column", table: "form_responses", column: "dob" },
    { kind: "column", table: "form_responses", column: "id_attachment_id" },
    { kind: "column", table: "form_responses", column: "verified_at" },
    { kind: "column", table: "business_settings", column: "id_retention_days" },
  ],
  50: [
    { kind: "table", table: "class_sessions" },
    { kind: "table", table: "class_enrollments" },
    { kind: "column", table: "services", column: "is_class" },
    { kind: "column", table: "services", column: "class_capacity" },
  ],
  51: [
    { kind: "table", table: "packages" },
    { kind: "table", table: "client_packages" },
    { kind: "table", table: "credit_ledger" },
    { kind: "column", table: "membership_plans", column: "kind" },
    { kind: "column", table: "membership_plans", column: "credits_per_period" },
    { kind: "column", table: "membership_plans", column: "rollover_max" },
    { kind: "column", table: "membership_plans", column: "eligible_service_ids" },
    { kind: "column", table: "appointments", column: "credit_entry_id" },
    { kind: "column", table: "charges", column: "client_package_id" },
  ],
  52: [
    { kind: "table", table: "queue_entries" },
    { kind: "column", table: "business_settings", column: "queue_open" },
    { kind: "column", table: "business_settings", column: "queue_max_waiting" },
    { kind: "column", table: "business_settings", column: "queue_text_on_join" },
    { kind: "column", table: "business_settings", column: "queue_kiosk_token_hash" },
  ],
  53: [
    { kind: "table", table: "waitlist_openings" },
    { kind: "table", table: "slot_waitlist" },
    { kind: "column", table: "business_settings", column: "waitlist_hold_minutes" },
  ],
  54: [
    { kind: "table", table: "gift_cards" },
    { kind: "table", table: "gift_card_transactions" },
    { kind: "column", table: "charges", column: "gift_card_id" },
    { kind: "column", table: "charges", column: "gift_card_cents" },
  ],
  55: [
    { kind: "table", table: "checklist_templates" },
    { kind: "table", table: "appointment_checklist_items" },
    { kind: "column", table: "attachments", column: "caption" },
  ],
  56: [
    { kind: "table", table: "custom_field_definitions" },
    { kind: "column", table: "clients", column: "attributes" },
    { kind: "column", table: "appointments", column: "attributes" },
    { kind: "column", table: "products", column: "tags" },
    { kind: "index", name: "clients_attributes_gin" },
  ],
  57: [
    { kind: "absent_column", table: "clients", column: "hair_types" },
    { kind: "absent_column", table: "products", column: "hair_types" },
  ],
  58: [
    { kind: "column", table: "branding_settings", column: "brand_color" },
    { kind: "column", table: "branding_settings", column: "font_pairing" },
    { kind: "column", table: "branding_settings", column: "corner_style" },
    { kind: "column", table: "branding_settings", column: "density" },
    { kind: "column", table: "branding_settings", column: "color_mode" },
  ],
  59: [{ kind: "column", table: "appointments", column: "checked_in_at" }],
};

type State = "present" | "missing" | "partial";

interface TenantReport {
  slug: string;
  status: string;
  schemaVersion: number;
  schemaExists: boolean;
  states: Map<number, State>;
  partialDetail: Map<number, string[]>;
  applied: number[];
  /** True when 0040 has already renamed this schema (staff exists, stylists does not). */
  renamed0040: boolean;
  error?: string;
}

function label(m: Marker): string {
  if (m.kind === "index") return `index ${m.name}`;
  if (m.kind === "absent_column") return `no ${m.table}.${m.column}`;
  return m.kind === "table" ? m.table : `${m.table}.${m.column}`;
}

/** Pre-0040 marker names, resolved on a schema that 0040 has already renamed. */
export function resolveRepairMarker(mk: Marker, version: number, renamed0040: boolean): Marker {
  if (!renamed0040 || version >= 40 || mk.kind === "index" || mk.kind === "absent_column") return mk;
  const table = tableAlias.get(mk.table) ?? mk.table;
  if (mk.kind === "table") return { kind: "table", table };
  return {
    kind: "column",
    table,
    column: columnAlias.get(`${table}.${mk.column}`) ?? mk.column,
  };
}

/** True when this marker's object is in the inspected schema. */
export function markerPresent(
  mk: Marker,
  cols: Set<string>,
  idxs: Set<string>,
  tbls: Set<string>,
): boolean {
  if (mk.kind === "index") return idxs.has(mk.name);
  if (mk.kind === "table") return tbls.has(mk.table);
  if (mk.kind === "absent_column") return !cols.has(`${mk.table}.${mk.column}`);
  const key = `${mk.table}.${mk.column}`;
  if (DROPPED_LATER.has(key) && !cols.has(key) && cols.has("clients.attributes")) return true;
  return cols.has(key);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[repair-tenants] DATABASE_URL is not set (.env.local). Aborting.");
    process.exit(1);
  }
  const apply = process.argv.includes("--apply");

  const { sql } = await import("drizzle-orm");
  const { publicDb } = await import("../src/lib/db");
  const { tenants } = await import("../src/lib/db/schema");
  const { migrations, LATEST_SCHEMA_VERSION } = await import(
    "../src/lib/tenant/migrations"
  );
  const { eq } = await import("drizzle-orm");

  const toCheck = migrations.filter((m) => m.version >= FIRST_REPAIRED_VERSION);
  for (const m of toCheck) {
    if (!MARKERS[m.version]) {
      console.error(
        `[repair-tenants] No marker query defined for migration ${m.version}; add it to MARKERS.`,
      );
      process.exit(1);
    }
  }

  console.log(
    `[repair-tenants] mode=${apply ? "APPLY" : "DRY RUN"} checking migrations ${FIRST_REPAIRED_VERSION}-${LATEST_SCHEMA_VERSION}`,
  );

  const allTenants = await publicDb
    .select({
      slug: tenants.slug,
      status: tenants.status,
      schemaVersion: tenants.schemaVersion,
    })
    .from(tenants)
    .orderBy(tenants.slug);

  async function inspect(t: {
    slug: string;
    status: string;
    schemaVersion: number;
  }): Promise<TenantReport> {
    const schemaName = `tenant_${t.slug}`;
    const report: TenantReport = {
      ...t,
      schemaExists: false,
      states: new Map(),
      partialDetail: new Map(),
      applied: [],
      renamed0040: false,
    };
    const rows = Array.from(
      (await publicDb.execute(
        sql`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = ${schemaName}`,
      )) as Iterable<Record<string, unknown>>,
    );
    report.schemaExists = rows.length > 0;
    const cols = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
    const tbls = new Set(rows.map((r) => r.table_name as string));
    const idxRows = Array.from(
      (await publicDb.execute(
        sql`SELECT indexname FROM pg_indexes WHERE schemaname = ${schemaName}`,
      )) as Iterable<Record<string, unknown>>,
    );
    const idxs = new Set(idxRows.map((r) => r.indexname as string));
    const renamed0040 = tbls.has("staff") && !tbls.has("stylists");
    report.renamed0040 = renamed0040;
    for (const m of toCheck) {
      const markers = MARKERS[m.version].map((mk) =>
        resolveRepairMarker(mk, m.version, renamed0040),
      );
      const present = markers.filter((mk) => markerPresent(mk, cols, idxs, tbls));
      const state: State =
        present.length === markers.length
          ? "present"
          : present.length === 0
            ? "missing"
            : "partial";
      report.states.set(m.version, state);
      if (state === "partial") {
        report.partialDetail.set(
          m.version,
          markers.filter((mk) => !present.includes(mk)).map(label),
        );
      }
    }
    return report;
  }

  const reports: TenantReport[] = [];
  const before = new Map<string, number[]>();

  for (const t of allTenants) {
    let report = await inspect(t);
    const missing = () =>
      toCheck
        .map((m) => m.version)
        .filter((v) => report.states.get(v) === "missing");
    before.set(t.slug, missing());

    if (!report.schemaExists) {
      report.error = "schema not found";
    } else if (apply && missing().length > 0) {
      if (t.schemaVersion < FIRST_REPAIRED_VERSION - 1) {
        report.error = `schema_version ${t.schemaVersion} < ${FIRST_REPAIRED_VERSION - 1}; run migrate:tenants first`;
      } else if (report.renamed0040 && missing().some((v) => v < 40)) {
        report.error =
          "pre-0040 migration missing on a renamed schema (its SQL uses pre-0040 names); manual review";
      } else {
        const schemaName = `tenant_${t.slug}`;
        const versions = missing();
        try {
          await publicDb.transaction(async (tx) => {
            await tx.execute(
              sql`SELECT 1 FROM ${tenants} WHERE ${tenants.slug} = ${t.slug} FOR UPDATE`,
            );
            for (const m of toCheck.filter((x) => versions.includes(x.version))) {
              for (const stmt of m.up(schemaName)) {
                await tx.execute(stmt);
              }
            }
            await tx
              .update(tenants)
              .set({ schemaVersion: LATEST_SCHEMA_VERSION, updatedAt: new Date() })
              .where(eq(tenants.slug, t.slug));
          });
          report = await inspect(t);
          report.applied = versions;
        } catch (err) {
          report.error = `apply failed (rolled back): ${(err as Error).message}`;
        }
      }
    }
    reports.push(report);
  }

  // Per-tenant detail
  console.log("\nPer-tenant detail:");
  for (const r of reports) {
    const miss = toCheck
      .map((m) => m.version)
      .filter((v) => r.states.get(v) === "missing");
    const partial = [...r.partialDetail.entries()];
    console.log(`- ${r.slug} [${r.status}] schema_version=${r.schemaVersion}`);
    if (!r.schemaExists) console.log("    schema does not exist");
    else {
      const was = before.get(r.slug) ?? [];
      console.log(`    missing before: ${was.length ? was.join(", ") : "none"}`);
      if (r.applied.length) console.log(`    applied: ${r.applied.join(", ")}`);
      console.log(`    missing now: ${miss.length ? miss.join(", ") : "none"}`);
    }
    for (const [v, objs] of partial) {
      console.log(
        `    MANUAL REVIEW: migration ${v} partially present; absent: ${objs.join(", ")}`,
      );
    }
    if (r.error) console.log(`    ERROR: ${r.error}`);
  }

  // Summary table
  console.log("\nSummary:");
  const rows = reports.map((r) => {
    const fmt = (vs: number[]) => (vs.length ? vs.join(",") : "-");
    const now = toCheck
      .map((m) => m.version)
      .filter((v) => r.states.get(v) === "missing");
    return {
      tenant: r.slug,
      status: r.status,
      schema_version: r.schemaVersion,
      missing_before: fmt(before.get(r.slug) ?? []),
      applied: fmt(r.applied),
      missing_now: fmt(now),
      manual_review: fmt([...r.partialDetail.keys()]),
      error: r.error ?? "",
    };
  });
  console.table(rows);

  const totalMissing = rows.filter((r) => r.missing_now !== "-").length;
  const totalPartial = rows.filter((r) => r.manual_review !== "-").length;
  const errors = rows.filter((r) => r.error).length;
  console.log(
    `Tenants checked: ${rows.length}; with missing migrations: ${totalMissing}; needing manual review: ${totalPartial}; errors: ${errors}`,
  );
  if (!apply && totalMissing > 0) {
    console.log("Dry run only. Re-run with --apply to repair.");
  }
  process.exit(errors > 0 ? 1 : 0);
}

const entry = process.argv[1] ?? "";
if (entry.includes("repair-tenant-schemas")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
