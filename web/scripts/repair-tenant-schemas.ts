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
import { COLUMN_RENAMES_0040, TABLE_RENAMES_0040 } from "../src/lib/tenant/migrations/0040-domain-renames";
import {
  inspectDomainCompatibilityRepair,
  type CatalogExecutor,
  type DomainCompatibilityInspection,
  type DomainCompatibilityState,
} from "../src/lib/tenant/domain-compatibility-repair";
import { sql } from "drizzle-orm";
import type { TenantMigration } from "../src/lib/tenant/migrations";

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

export type RepairState = DomainCompatibilityState | "unknown";

export interface RepairTenantInfo {
  slug: string;
  status: string;
  schemaVersion: number;
  dbShard?: string | null;
}

export interface TenantReport extends RepairTenantInfo {
  schemaExists: boolean;
  states: Map<number, RepairState>;
  partialDetail: Map<number, string[]>;
  deferred: Set<number>;
  applied: number[];
  /** True when the canonical ordinary staff table proves migration 0040 is complete. */
  renamed0040: boolean;
  error?: string;
}

export interface RepairTransaction extends CatalogExecutor {
  lockTenant(slug: string): Promise<RepairTenantInfo | null>;
  applyMigration(migration: TenantMigration, schema: string): Promise<void>;
  setSchemaVersion(slug: string, version: number): Promise<void>;
}

export interface RepairBackend extends CatalogExecutor {
  listTenants(): Promise<RepairTenantInfo[]>;
  inspectTenant(tenant: RepairTenantInfo, executor: CatalogExecutor): Promise<TenantReport>;
  transaction<T>(operation: (tx: RepairTransaction) => Promise<T>): Promise<T>;
}

export interface RepairRunResult {
  reports: TenantReport[];
  missingBefore: Map<string, number[]>;
  exitCode: 0 | 1;
  coverageFailures: number[];
}

type RepairInspector = (executor: CatalogExecutor, schema: string) => Promise<DomainCompatibilityInspection>;

const SPECIAL_INSPECTORS: ReadonlyMap<number, RepairInspector> = new Map([
  [60, inspectDomainCompatibilityRepair],
]);

function label(m: Marker): string {
  if (m.kind === "index") return `index ${m.name}`;
  if (m.kind === "absent_column") return `no ${m.table}.${m.column}`;
  return m.kind === "table" ? m.table : `${m.table}.${m.column}`;
}

/** Pre-0040 marker names, resolved on a schema with the canonical 0040 table rename. */
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

/** Registry coverage includes marker-backed migrations and the explicit v60 catalog inspector. */
export function uncoveredRepairVersions(
  migrations: readonly Pick<TenantMigration, "version">[],
): number[] {
  return migrations
    .filter((migration) => migration.version >= FIRST_REPAIRED_VERSION)
    .map((migration) => migration.version)
    .filter((version) => {
      if (SPECIAL_INSPECTORS.has(version)) return false;
      return !Array.isArray(MARKERS[version]) || MARKERS[version].length === 0;
    });
}

function missingCoverage(
  migrations: readonly Pick<TenantMigration, "version">[],
): number[] {
  return uncoveredRepairVersions(migrations);
}

function rows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === "object") {
    const resultRows = (result as { rows?: unknown }).rows;
    if (Array.isArray(resultRows)) return resultRows as Array<Record<string, unknown>>;
    if (Symbol.iterator in result) return Array.from(result as Iterable<Record<string, unknown>>);
  }
  return [];
}

function value(row: Record<string, unknown>, key: string): string {
  const item = row[key];
  return item == null ? "" : String(item);
}

function newReport(tenant: RepairTenantInfo): TenantReport {
  return {
    ...tenant,
    schemaExists: false,
    states: new Map(),
    partialDetail: new Map(),
    deferred: new Set(),
    applied: [],
    renamed0040: false,
  };
}

function setAttention(report: TenantReport, version: number, detail: string[]) {
  report.partialDetail.set(version, detail.slice(0, 24));
}

function isAttention(report: TenantReport): boolean {
  return [...report.states.values()].some((state) => state === "partial" || state === "blocked" || state === "unknown");
}

function missingVersions(report: TenantReport, migrations: readonly TenantMigration[]): number[] {
  return migrations
    .filter((migration) => report.states.get(migration.version) === "missing")
    .map((migration) => migration.version);
}

function attentionVersions(report: TenantReport): number[] {
  return [...report.states.entries()]
    .filter(([, state]) => state === "partial" || state === "blocked" || state === "unknown")
    .map(([version]) => version);
}

function tenantSchema(slug: string): string | null {
  const schema = `tenant_${slug}`;
  return /^tenant_[a-z0-9_-]+$/.test(schema) && schema.length <= 63 ? schema : null;
}

function describeShard(shard: string | null | undefined): string {
  if (shard === null || shard === undefined) return "<missing>";
  if (shard.trim() === "") return "<blank>";
  return JSON.stringify(shard.slice(0, 64));
}

/** Inspects marker migrations plus v60 without opening a database connection itself. */
export async function inspectTenantSchema(
  tenant: RepairTenantInfo,
  executor: CatalogExecutor,
  migrations: readonly TenantMigration[],
): Promise<TenantReport> {
  const report = newReport(tenant);
  const schema = tenantSchema(tenant.slug);
  if (!schema) {
    report.error = "invalid tenant schema name; refusing inspection";
    return report;
  }

  const relationRows = rows(await executor.execute(sql`
    SELECT c.relname AS name, c.relkind::text AS kind
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ${schema}
  `));
  const columnRows = rows(await executor.execute(sql`
    SELECT table_name, column_name
    FROM information_schema.columns WHERE table_schema = ${schema}
  `));
  const indexRows = rows(await executor.execute(sql`
    SELECT indexname FROM pg_indexes WHERE schemaname = ${schema}
  `));
  report.schemaExists = relationRows.length > 0;
  if (!report.schemaExists) return report;

  const cols = new Set(columnRows.map((row) => `${value(row, "table_name")}.${value(row, "column_name")}`));
  const relations = new Set(relationRows.map((row) => value(row, "name")));
  const ordinaryTables = new Set(
    relationRows.filter((row) => value(row, "kind") === "r").map((row) => value(row, "name")),
  );
  const idxs = new Set(indexRows.map((row) => value(row, "indexname")));
  // v60 intentionally adds a stylists VIEW. The ordinary canonical staff table is the 0040 signal.
  report.renamed0040 = ordinaryTables.has("staff");

  let v60Inspection: DomainCompatibilityInspection | undefined;
  if (report.renamed0040 && migrations.some((migration) => migration.version === 60)) {
    v60Inspection = await SPECIAL_INSPECTORS.get(60)!(executor, schema);
  }

  for (const migration of migrations) {
    if (migration.version < FIRST_REPAIRED_VERSION) continue;
    if (migration.version === 60) {
      if (!report.renamed0040) {
        // Old stylists tables are normal before 0040. Inspect v60 after rename prerequisites
        // have run in the same repair transaction, immediately before deciding on migration 60.
        report.states.set(60, "missing");
        report.deferred.add(60);
      } else if (v60Inspection) {
        report.states.set(60, v60Inspection.state);
        if (v60Inspection.state === "partial" || v60Inspection.state === "blocked") {
          setAttention(report, 60, [...v60Inspection.objects, ...v60Inspection.reasons]);
        }
      }
      continue;
    }
    const markers = MARKERS[migration.version].map((marker) =>
      resolveRepairMarker(marker, migration.version, report.renamed0040),
    );
    const present = markers.filter((marker) => markerPresent(marker, cols, idxs, relations));
    const state: RepairState = present.length === markers.length
      ? "present"
      : present.length === 0
        ? "missing"
        : "partial";
    report.states.set(migration.version, state);
    if (state === "partial") {
      setAttention(report, migration.version, markers.filter((marker) => !present.includes(marker)).map(label));
    }
  }
  return report;
}

class RepairTransactionAbort extends Error {}

function replaceReport(target: TenantReport, source: TenantReport) {
  target.schemaVersion = source.schemaVersion;
  target.dbShard = source.dbShard;
  target.schemaExists = source.schemaExists;
  target.states = source.states;
  target.partialDetail = source.partialDetail;
  target.deferred = source.deferred;
  target.renamed0040 = source.renamed0040;
}

function throwForAttention(report: TenantReport) {
  if (!isAttention(report)) return;
  const versions = attentionVersions(report);
  const error = new RepairTransactionAbort(
    `manual attention required for migration${versions.length === 1 ? "" : "s"} ${versions.join(", ")}; skipped all tenant apply work`,
  );
  throw error;
}

/** Applies repairs only after a read-only preflight and a locked, fresh transactional recheck. */
export async function runRepairCommand(options: {
  apply: boolean;
  migrations: readonly TenantMigration[];
  latestSchemaVersion: number;
  backend: RepairBackend;
}): Promise<RepairRunResult> {
  const toCheck = [...options.migrations]
    .filter((migration) => migration.version >= FIRST_REPAIRED_VERSION)
    .sort((a, b) => a.version - b.version);
  const coverageFailures = missingCoverage(toCheck);
  if (coverageFailures.length > 0) {
    return { reports: [], missingBefore: new Map(), exitCode: 1, coverageFailures };
  }

  const allTenants = await options.backend.listTenants();
  const reports: TenantReport[] = [];
  const missingBefore = new Map<string, number[]>();

  for (const tenant of allTenants) {
    const report = newReport(tenant);
    missingBefore.set(tenant.slug, []);
    if (tenant.dbShard !== "primary") {
      report.error = `unsupported database shard ${describeShard(tenant.dbShard)}; primary-only repair was not attempted`;
      reports.push(report);
      continue;
    }
    if (!tenantSchema(tenant.slug)) {
      report.error = "invalid tenant schema name; refusing inspection and repair";
      reports.push(report);
      continue;
    }
    if (tenant.schemaVersion > options.latestSchemaVersion) {
      report.error = `schema_version ${tenant.schemaVersion} exceeds supported version ${options.latestSchemaVersion}`;
      reports.push(report);
      continue;
    }

    try {
      const inspected = await options.backend.inspectTenant(tenant, options.backend);
      replaceReport(report, inspected);
    } catch (error) {
      report.error = `inspection failed: ${(error as Error).message}`;
      reports.push(report);
      continue;
    }
    const before = missingVersions(report, toCheck);
    missingBefore.set(tenant.slug, before);

    if (!report.schemaExists) {
      report.error = "schema not found";
    } else if (isAttention(report)) {
      const versions = attentionVersions(report);
      report.error = `manual attention required for migration${versions.length === 1 ? "" : "s"} ${versions.join(", ")}; skipped all tenant apply work`;
    } else if (options.apply && before.length > 0) {
      if (tenant.schemaVersion < FIRST_REPAIRED_VERSION - 1) {
        report.error = `schema_version ${tenant.schemaVersion} < ${FIRST_REPAIRED_VERSION - 1}; run migrate:tenants first`;
      } else if (report.renamed0040 && before.some((version) => version < 40)) {
        report.error = "pre-0040 migration missing on a renamed schema (its SQL uses pre-0040 names); manual review";
      } else {
        const schema = tenantSchema(tenant.slug)!;
        const applied: number[] = [];
        let committedVerification: TenantReport | undefined;
        let transactionCommitted = false;
        try {
          await options.backend.transaction(async (tx) => {
            const locked = await tx.lockTenant(tenant.slug);
            if (!locked) throw new RepairTransactionAbort("tenant row disappeared before apply");
            if (locked.dbShard !== "primary") {
              throw new RepairTransactionAbort(`unsupported database shard ${describeShard(locked.dbShard)} after row lock`);
            }
            if (locked.schemaVersion > options.latestSchemaVersion) {
              throw new RepairTransactionAbort(`schema_version ${locked.schemaVersion} exceeds supported version ${options.latestSchemaVersion}`);
            }
            if (locked.schemaVersion < FIRST_REPAIRED_VERSION - 1) {
              throw new RepairTransactionAbort(`schema_version ${locked.schemaVersion} < ${FIRST_REPAIRED_VERSION - 1}; run migrate:tenants first`);
            }

            let fresh = await options.backend.inspectTenant(locked, tx);
            if (!fresh.schemaExists) throw new RepairTransactionAbort("schema not found after row lock");
            throwForAttention(fresh);
            if (fresh.renamed0040 && missingVersions(fresh, toCheck).some((version) => version < 40)) {
              throw new RepairTransactionAbort("pre-0040 migration missing on a renamed schema (its SQL uses pre-0040 names); manual review");
            }

            for (const migration of toCheck) {
              if (fresh.states.get(migration.version) !== "missing") continue;
              if (migration.version === 60) {
                // Reinspect after all preceding repairs, under the same lock/transaction.
                fresh = await options.backend.inspectTenant(locked, tx);
                if (!fresh.renamed0040) {
                  throw new RepairTransactionAbort("migration 0040 prerequisites were not established before 0060");
                }
                throwForAttention(fresh);
                const v60State = fresh.states.get(60);
                if (v60State === "present") continue;
                if (v60State !== "missing") {
                  throw new RepairTransactionAbort("migration 0060 preflight did not return an eligible missing state");
                }
              }
              await tx.applyMigration(migration, schema);
              applied.push(migration.version);
            }

            const verified = await options.backend.inspectTenant(locked, tx);
            throwForAttention(verified);
            const unresolved = toCheck
              .filter((migration) => verified.states.get(migration.version) !== "present")
              .map((migration) => migration.version);
            if (unresolved.length > 0) {
              const error = new RepairTransactionAbort(`post-apply verification failed for migrations ${unresolved.join(", ")}`);
              throw error;
            }
            committedVerification = verified;
            await tx.setSchemaVersion(tenant.slug, options.latestSchemaVersion);
          });
          transactionCommitted = true;
        } catch (error) {
          // Intermediate reports belong to a transaction that rolled back.
          report.error = `apply failed (rolled back): ${(error as Error).message}`;
        }

        if (transactionCommitted) {
          if (committedVerification) replaceReport(report, committedVerification);
          report.schemaVersion = options.latestSchemaVersion;
          report.applied = applied;
          try {
            const latestTenant = { ...tenant, schemaVersion: options.latestSchemaVersion };
            const after = await options.backend.inspectTenant(latestTenant, options.backend);
            replaceReport(report, after);
            report.schemaVersion = options.latestSchemaVersion;
            report.applied = applied;
            if (isAttention(report) || !toCheck.every((migration) => report.states.get(migration.version) === "present")) {
              report.error = `transaction committed with schema_version ${options.latestSchemaVersion}; post-commit verification did not confirm every repaired migration`;
            }
          } catch (error) {
            for (const migration of toCheck) {
              report.states.set(migration.version, "unknown");
              setAttention(report, migration.version, ["transaction committed; post-commit verification unavailable"]);
            }
            report.schemaVersion = options.latestSchemaVersion;
            report.applied = applied;
            report.error = `transaction committed with schema_version ${options.latestSchemaVersion}; post-commit verification unavailable: ${(error as Error).message}`;
          }
        }
      }
    }
    reports.push(report);
  }

  return {
    reports,
    missingBefore,
    exitCode: reports.some((report) => report.error || isAttention(report)) ? 1 : 0,
    coverageFailures: [],
  };
}

function printResult(result: RepairRunResult, apply: boolean, migrations: readonly TenantMigration[]) {
  console.log(`\nPer-tenant detail:`);
  for (const report of result.reports) {
    console.log(`- ${report.slug} [${report.status}] schema_version=${report.schemaVersion} shard=${describeShard(report.dbShard)}`);
    if (!report.schemaExists) console.log("    schema does not exist or was not inspected");
    else {
      const was = result.missingBefore.get(report.slug) ?? [];
      const now = missingVersions(report, migrations);
      console.log(`    missing before: ${was.length ? was.join(", ") : "none"}`);
      if (report.applied.length) console.log(`    applied: ${report.applied.join(", ")}`);
      console.log(`    missing now: ${now.length ? now.join(", ") : "none"}`);
    }
    for (const [version, objects] of report.partialDetail) {
      const state = report.states.get(version);
      const label = state === "blocked" ? "BLOCKED" : "MANUAL REVIEW";
      console.log(`    ${label}: migration ${version}; ${objects.join(", ")}`);
    }
    for (const version of report.deferred) {
      console.log(`    migration ${version}: inspection deferred until migration 0040 establishes canonical tables in the apply transaction`);
    }
    if (report.error) console.log(`    ERROR: ${report.error}`);
  }

  console.log("\nSummary:");
  const rows = result.reports.map((report) => {
    const fmt = (versions: number[]) => versions.length ? versions.join(",") : "-";
    return {
      tenant: report.slug,
      status: report.status,
      shard: describeShard(report.dbShard),
      schema_version: report.schemaVersion,
      missing_before: fmt(result.missingBefore.get(report.slug) ?? []),
      applied: fmt(report.applied),
      needs_attention: fmt(attentionVersions(report)),
      error: report.error ?? "",
    };
  });
  console.table(rows);
  const totalMissing = result.reports.filter((report) => missingVersions(report, migrations).length > 0).length;
  const totalAttention = result.reports.filter(isAttention).length;
  const errors = result.reports.filter((report) => report.error).length + result.coverageFailures.length;
  console.log(`Tenants checked: ${rows.length}; with missing migrations: ${totalMissing}; needing manual review: ${totalAttention}; errors: ${errors}`);
  if (!apply && totalMissing > 0) console.log("Dry run only. Re-run with --apply to repair.");
  if (result.coverageFailures.length > 0) {
    console.error(`[repair-tenants] No marker query or special inspector defined for migration${result.coverageFailures.length === 1 ? "" : "s"} ${result.coverageFailures.join(", ")}; refusing tenant scan.`);
  }
}

async function main() {
  const { config } = await import("dotenv");
  config({ path: ".env.local" });
  config({ path: ".env" });
  if (!process.env.DATABASE_URL) {
    console.error("[repair-tenants] DATABASE_URL is not set (.env.local). Aborting.");
    process.exit(1);
  }
  const apply = process.argv.includes("--apply");
  const { publicDb, closePublicDb } = await import("../src/lib/db");
  const { tenants } = await import("../src/lib/db/schema");
  const { migrations, LATEST_SCHEMA_VERSION } = await import("../src/lib/tenant/migrations");
  const { eq } = await import("drizzle-orm");
  const repairMigrations = migrations.filter((migration) => migration.version >= FIRST_REPAIRED_VERSION);

  const backend: RepairBackend = {
    execute: (query) => publicDb.execute(query),
    inspectTenant: (tenant, executor) => inspectTenantSchema(tenant, executor, repairMigrations),
    listTenants: () => publicDb.select({
      slug: tenants.slug,
      status: tenants.status,
      schemaVersion: tenants.schemaVersion,
      dbShard: tenants.dbShard,
    }).from(tenants).orderBy(tenants.slug),
    transaction: (operation) => publicDb.transaction(async (transaction) => operation({
      execute: (query) => transaction.execute(query),
      lockTenant: async (slug) => {
        const [row] = await transaction.select({
          slug: tenants.slug,
          status: tenants.status,
          schemaVersion: tenants.schemaVersion,
          dbShard: tenants.dbShard,
        }).from(tenants).where(eq(tenants.slug, slug)).for("update");
        return row ?? null;
      },
      applyMigration: async (migration, schema) => {
        for (const statement of migration.up(schema)) await transaction.execute(statement);
      },
      setSchemaVersion: async (slug, version) => {
        await transaction.update(tenants)
          .set({ schemaVersion: version, updatedAt: new Date() })
          .where(eq(tenants.slug, slug));
      },
    })),
  };

  console.log(`[repair-tenants] mode=${apply ? "APPLY" : "DRY RUN"} checking migrations ${FIRST_REPAIRED_VERSION}-${LATEST_SCHEMA_VERSION}`);
  const result = await runRepairCommand({ apply, migrations: repairMigrations, latestSchemaVersion: LATEST_SCHEMA_VERSION, backend });
  printResult(result, apply, repairMigrations);
  await closePublicDb();
  process.exit(result.exitCode);
}

const entry = process.argv[1] ?? "";
if (entry.includes("repair-tenant-schemas")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
