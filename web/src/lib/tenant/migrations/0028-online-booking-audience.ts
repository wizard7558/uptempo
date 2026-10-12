import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0028: control who may self-book online.
 *
 * `online_booking_audience`:
 *  - 'both'          — anyone can book (default, unchanged behaviour)
 *  - 'existing_only' — only clients already in the salon's book may self-book
 *  - 'new_only'      — only first-time clients may self-book
 */
export const migration: TenantMigration = {
  version: 28,
  description: "Add online_booking_audience to salon_policies",
  up: (schemaName: string): SQL[] => [
    sql.raw(
      `ALTER TABLE "${schemaName}".salon_policies ADD COLUMN IF NOT EXISTS online_booking_audience text NOT NULL DEFAULT 'both'`,
    ),
  ],
};
