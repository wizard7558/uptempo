import type { SQL } from "drizzle-orm";

/**
 * Describes a single tenant schema migration.
 * Each migration targets a specific version and provides SQL statements
 * to apply to a tenant's schema.
 */
export interface TenantMigration {
  /** Target version number (must be unique and sequential) */
  version: number;
  /** Human-readable description of what this migration does */
  description: string;
  /** Returns SQL statements to execute within the tenant's schema */
  up: (schemaName: string) => SQL[];
  /** Reverses `up`. Required for every migration with version >= 40 (registry.test enforces). */
  down?: (schemaName: string) => SQL[];
}

import { migration as m0002 } from "./0002-payment-method-settings";
import { migration as m0003 } from "./0003-sms-consent";
import { migration as m0004 } from "./0004-branding-settings";
import { migration as m0005 } from "./0005-smart-scheduling";
import { migration as m0006 } from "./0006-assistant-workflows";
import { migration as m0007 } from "./0007-beta-foundation";
import { migration as m0008 } from "./0008-multi-location";
import { migration as m0009 } from "./0009-client-profile-columns";
import { migration as m0010 } from "./0010-appointments-overlap-per-location";
import { migration as m0011 } from "./0011-double-book-parent";
import { migration as m0012 } from "./0012-service-cost-cents";
import { migration as m0013 } from "./0013-service-assistant-workflow";
import { migration as m0014 } from "./0014-calendar-error-count";
import { migration as m0015 } from "./0015-beauty-bank-membership";
import { migration as m0016 } from "./0016-time-blocks";
import { migration as m0017 } from "./0017-appointment-client-status";
import { migration as m0018 } from "./0018-charges-tip";
import { migration as m0019 } from "./0019-services-description";
import { migration as m0020 } from "./0020-sms-policies-additions";
import { migration as m0021 } from "./0021-stylist-service-overrides";
import { migration as m0022 } from "./0022-stylists-phone";
import { migration as m0023 } from "./0023-assistant-tasks-nullable-appointment";
import { migration as m0024 } from "./0024-policy-text-and-signatures";
import { migration as m0025 } from "./0025-device-tokens-and-push-reminders";
import { migration as m0026 } from "./0026-clients-soft-delete";
import { migration as m0027 } from "./0027-service-booking-controls";
import { migration as m0028 } from "./0028-online-booking-audience";
import { migration as m0029 } from "./0029-service-categories";
import { migration as m0030 } from "./0030-service-addons";
import { migration as m0031 } from "./0031-deposits";
import { migration as m0032 } from "./0032-beauty-bank-expiry";
import { migration as m0033 } from "./0033-custom-membership-amount";
import { migration as m0034 } from "./0034-capacity-coach";
import { migration as m0035 } from "./0035-products";
import { migration as m0036 } from "./0036-storefront-checkout";
import { migration as m0037 } from "./0037-service-booking-audience";
import { migration as m0038 } from "./0038-salon-monthly-revenue-goal";
import { migration as m0039 } from "./0039-double-book-index";
import { migration as m0040 } from "./0040-domain-renames";
import { migration as m0041 } from "./0041-expense-categories";
import { migration as m0042 } from "./0042-booking-rules";
import { migration as m0043 } from "./0043-availability";
import { migration as m0044 } from "./0044-resources";
import { migration as m0045 } from "./0045-booking-groups";
import { migration as m0046 } from "./0046-recurrence";
import { migration as m0047 } from "./0047-requests-quotes";
import { migration as m0048 } from "./0048-on-site";
import { migration as m0049 } from "./0049-projects-consent";
import { migration as m0050 } from "./0050-classes";
import { migration as m0051 } from "./0051-packages-credits";
import { migration as m0052 } from "./0052-walk-in-queue";
import { migration as m0053 } from "./0053-slot-waitlist";
import { migration as m0054 } from "./0054-gift-cards";
import { migration as m0055 } from "./0055-photos-checklists";
import { migration as m0056 } from "./0056-custom-fields";
import { migration as m0057 } from "./0057-drop-hair-types";
import { migration as m0058 } from "./0058-branding-theme";
import { migration as m0059 } from "./0059-appointment-check-in";
import { migration as m0060 } from "./0060-domain-compatibility";

/**
 * Ordered registry of all tenant schema migrations.
 */
const registry: TenantMigration[] = [
  m0002,
  m0003,
  m0004,
  m0005,
  m0006,
  m0007,
  m0008,
  m0009,
  m0010,
  m0011,
  m0012,
  m0013,
  m0014,
  m0015,
  m0016,
  m0017,
  m0018,
  m0019,
  m0020,
  m0021,
  m0022,
  m0023,
  m0024,
  m0025,
  m0026,
  m0027,
  m0028,
  m0029,
  m0030,
  m0031,
  m0032,
  m0033,
  m0034,
  m0035,
  m0036,
  m0037,
  m0038,
  m0039,
  m0040,
  m0041,
  m0042,
  m0043,
  m0044,
  m0045,
  m0046,
  m0047,
  m0048,
  m0049,
  m0050,
  m0051,
  m0052,
  m0053,
  m0054,
  m0055,
  m0056,
  m0057,
  m0058,
  m0059,
  m0060,
];

export const migrations: TenantMigration[] = registry.sort(
  (a, b) => a.version - b.version,
);

/**
 * The latest schema version. New tenants are provisioned at this version
 * so they never need to run historical migrations.
 * Defaults to 1 when no migrations exist (baseline).
 */
export const LATEST_SCHEMA_VERSION =
  migrations.length > 0 ? migrations[migrations.length - 1].version : 1;

/**
 * Schema version produced by the hand-written baseline DDL in baseline.ts.
 * The baseline already includes the objects from migrations 0002-0006, so
 * provisioning applies every registry migration with a version above this.
 */
export const TENANT_BASELINE_VERSION = 6;

/** Ordered registry migrations that provisioning must apply after the baseline. */
export function getMigrationsAfterBaseline(
  baselineVersion: number = TENANT_BASELINE_VERSION,
): TenantMigration[] {
  return migrations.filter((m) => m.version > baselineVersion);
}
