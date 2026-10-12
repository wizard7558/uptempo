import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0038: salon-level monthly revenue goal.
 *
 * `monthly_revenue_goal_cents` on salon_policies is the owner's target service
 * revenue for a calendar month, in cents. NULL (the default) = no goal set, so
 * the dashboard shows goal progress only once a salon opts in. This is the first
 * salon-wide revenue goal — prior goals lived per-stylist on `stylists`.
 */
export const migration: TenantMigration = {
  version: 38,
  description: "Add monthly_revenue_goal_cents to salon_policies",
  up: (schemaName: string): SQL[] => [
    sql.raw(
      `ALTER TABLE "${schemaName}".salon_policies ADD COLUMN IF NOT EXISTS monthly_revenue_goal_cents integer`,
    ),
  ],
};
